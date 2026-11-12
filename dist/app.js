(() => {
  const $ = (id) => document.getElementById(id);
  const maxBytes = 25 * 1024 * 1024;
  let latestReport = null;
  const sample = `customer_id,email,age,plan,monthly_spend,country\n1001,ava@example.com,29,Pro,49,India\n1002,noah@example.com,34,Free,0,India\n1003,,unknown,Free,0,India\n1004,mia@example.com,42,Pro,59,United States\n1005,liam@example.com,31,Free,0,India\n1005,liam@example.com,31,Free,0,India\n1007,not-an-email,205,Enterprise,1200,India\n1008,olivia@example.com,28,Free,,India\n1009,ethan@example.com,35,Free,0,India\n1010,sophia@example.com,33,Free,0,India\n1011,james@example.com,27,Free,0,India\n1012,isabella@example.com,30,Free,0,India`;

  function parseCSV(text) {
    const rows = []; let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) { const c = text[i], n = text[i + 1];
      if (c === '"' && quoted && n === '"') { field += '"'; i++; }
      else if (c === '"') quoted = !quoted;
      else if (c === ',' && !quoted) { row.push(field); field = ''; }
      else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && n === '\n') i++; row.push(field); if (row.some(v => v.trim() !== '')) rows.push(row); row = []; field = ''; }
      else field += c;
    }
    row.push(field); if (row.some(v => v.trim() !== '')) rows.push(row);
    if (quoted) throw new Error('The CSV has an unmatched quote. Please correct it and try again.');
    if (rows.length < 2) throw new Error('Add a header row and at least one data row.');
    const headers = rows[0].map((h, i) => (h.trim() || `Unnamed column ${i + 1}`).trim());
    if (new Set(headers).size !== headers.length) throw new Error('Column names must be unique. Please rename duplicate headers.');
    const malformed = rows.slice(1).findIndex(r => r.length !== headers.length);
    if (malformed >= 0) throw new Error(`Row ${malformed + 2} has ${rows[malformed + 1].length} cells but the header has ${headers.length}. Check commas and quotes.`);
    const data = rows.slice(1).map((r) => headers.map((_, i) => (r[i] || '').trim()));
    return { headers, data };
  }
  function isBlank(v) { return v === '' || /^(na|n\/a|null|none|undefined)$/i.test(v); }
  function typeOf(values) { const filled = values.filter(v => !isBlank(v)); if (!filled.length) return 'empty'; const nums = filled.filter(v => /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(v)); const dates = filled.filter(v => !Number.isNaN(Date.parse(v)) && /[-/]/.test(v)); if (nums.length / filled.length >= .9) return 'numeric'; if (dates.length / filled.length >= .9) return 'date'; if (filled.length && new Set(filled).size / filled.length < .3) return 'categorical'; return 'text'; }
  function sensitive(name, values) { const s = `${name} ${values.slice(0, 100).join(' ')}`.toLowerCase(); const patterns = [['email', /email|e-mail/], ['phone number', /phone|mobile|tel/], ['address', /address|postcode|zip/], ['government identifier', /aadhaar|ssn|passport|pan/], ['date of birth', /birth|dob/], ['financial information', /card|iban|account.?number/]]; return patterns.filter(([, p]) => p.test(s)).map(([label]) => label); }
  function numericOutliers(values) { const nums = values.filter(v => !isBlank(v)).map(Number).filter(Number.isFinite).sort((a,b)=>a-b); if (nums.length < 4) return 0; const q = (p) => { const x=(nums.length-1)*p, lo=Math.floor(x), hi=Math.ceil(x); return nums[lo]+(nums[hi]-nums[lo])*(x-lo); }; const q1=q(.25), q3=q(.75), iqr=q3-q1; if (!iqr) return 0; return nums.filter(n => n < q1 - 1.5*iqr || n > q3 + 1.5*iqr).length; }
  function analyze(headers, data, sourceName) {
    const duplicateRows = data.length - new Set(data.map(r => JSON.stringify(r))).size;
    let missingCells=0, allOutliers=0; const columns=[]; const issues=[];
    headers.forEach((name, index) => { const values=data.map(r=>r[index]); const missing=values.filter(isBlank).length; missingCells+=missing; const filled=values.filter(v=>!isBlank(v)); const kind=typeOf(values); const distinct=new Set(filled).size; const signals=[]; const action=[]; const missingPct=data.length ? missing/data.length*100 : 0;
      if (missingPct >= 10) { signals.push({text:`${missingPct.toFixed(0)}% missing`,level: missingPct >= 30 ? 'risk':'warn'}); action.push('Define a missing-value policy'); issues.push({level:missingPct>=30?'high':'medium',title:`${name} has missing values`,detail:`${missingPct.toFixed(1)}% of rows are empty.`}); }
      const invalid = kind === 'numeric' ? filled.filter(v => !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(v)).length : 0;
      if (invalid) { signals.push({text:`${invalid} mixed type`,level:'warn'}); action.push('Standardize value formats'); }
      let outliers=0; if(kind==='numeric') { outliers=numericOutliers(values); allOutliers+=outliers; if(outliers) {signals.push({text:`${outliers} outlier${outliers===1?'':'s'}`,level:'warn'});action.push('Review extreme values');} }
      if(kind==='categorical' && filled.length) { const counts={}; filled.forEach(v=>counts[v]=(counts[v]||0)+1); const highest=Math.max(...Object.values(counts))/filled.length; if(highest>=.9 && distinct>1) {signals.push({text:`${(highest*100).toFixed(0)}% one value`,level:'warn'});action.push('Check class imbalance');issues.push({level:'medium',title:`${name} is heavily imbalanced`,detail:`One category accounts for ${(highest*100).toFixed(0)}% of filled values.`});} }
      const pii=sensitive(name, values); if(pii.length){ signals.push({text:`Possible ${pii.join(', ')}`,level:'risk'}); action.push('Confirm handling and access controls'); issues.push({level:'high',title:`Possible sensitive data in ${name}`,detail:`Pattern suggests ${pii.join(' or ')}. Verify policy and consent.`}); }
      const completeness=100-missingPct; const health=Math.max(0, Math.round(completeness - Math.min(30,outliers*5) - (pii.length?8:0))); columns.push({name,kind,missing,missingPct,distinct,outliers,signals,action:action.length?action.join(' · '):'Ready for use',health});
    });
    if(duplicateRows) issues.unshift({level:duplicateRows/data.length>.05?'high':'medium',title:`${duplicateRows} duplicate row${duplicateRows===1?'':'s'} found`,detail:'Exact duplicate records can inflate metrics and training examples.'});
    const cells=Math.max(1,headers.length*data.length), score=Math.max(0,Math.round(100-(missingCells/cells*100*.7)-Math.min(22,duplicateRows/Math.max(1,data.length)*100)-Math.min(18,allOutliers/Math.max(1,data.length)*25)-Math.min(20,issues.filter(i=>i.level==='high').length*7)-Math.min(12,issues.filter(i=>i.level==='medium').length*3)));
    return {generatedAt:new Date().toISOString(),sourceName,rows:data.length,columns:headers.length,score,missingCells,duplicateRows,outliers:allOutliers,issues,columnsDetail:columns};
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function label(score){return score>=90?'Excellent foundation':score>=75?'Mostly ready':score>=55?'Needs review':'High risk dataset';}
  function render(r) { latestReport=r; $('results').hidden=false; $('dataset-name').textContent=r.sourceName; $('dataset-meta').textContent=`${r.rows.toLocaleString()} rows · ${r.columns} columns · analyzed locally`; $('quality-score').textContent=r.score; $('score-label').textContent=label(r.score); $('score-summary').textContent=r.score>=75?'A few checks deserve attention before modeling.':'Resolve the highest-priority signals before using this data.'; $('score-ring').style.background=`conic-gradient(var(--teal) ${r.score*3.6}deg,#e4edf2 0deg)`; $('missing-count').textContent=r.missingCells.toLocaleString(); $('duplicate-count').textContent=r.duplicateRows.toLocaleString(); $('outlier-count').textContent=r.outliers.toLocaleString(); $('issue-total').textContent=r.issues.length;
    $('priorities').innerHTML=r.issues.length?r.issues.slice(0,6).map(i=>`<div class="priority ${i.level==='high'?'high':''}"><strong>${esc(i.title)}</strong><span>${esc(i.detail)}</span></div>`).join(''):`<div class="empty">No priority signals. Keep reviewing data against its real-world context.</div>`;
    $('health-bars').innerHTML=r.columnsDetail.slice(0,6).map(c=>`<div class="health-row"><span title="${esc(c.name)}">${esc(c.name.length>17?c.name.slice(0,16)+'…':c.name)}</span><div class="bar"><i class="${c.health<60?'risk':c.health<80?'warn':''}" style="width:${c.health}%"></i></div><b>${c.health}%</b></div>`).join('');
    $('column-table').innerHTML=r.columnsDetail.map(c=>`<tr><td>${esc(c.name)}</td><td>${esc(c.kind)}</td><td>${c.missingPct.toFixed(1)}%</td><td>${c.distinct.toLocaleString()}</td><td>${c.signals.length?c.signals.map(s=>`<span class="tag ${s.level}">${esc(s.text)}</span>`).join(''):'<span class="tag">No concern</span>'}</td><td>${esc(c.action)}</td></tr>`).join('');
    setTimeout(()=>$('results').scrollIntoView({behavior:'smooth',block:'start'}), 50);
  }
  function process(text,name){try{if(text.length>maxBytes) throw new Error('This file exceeds the 25 MB local-analysis limit.'); const {headers,data}=parseCSV(text.replace(/^\uFEFF/,'')); if(data.length>100000) throw new Error('This file has more than 100,000 rows. Reduce it before browser-local analysis.'); render(analyze(headers,data,name)); $('upload-error').hidden=true;}catch(e){$('upload-error').textContent=e.message;$('upload-error').hidden=false;}}
  $('file-input').addEventListener('change',e=>{const file=e.target.files[0];if(!file)return;if(file.size>maxBytes){$('upload-error').textContent='This file exceeds the 25 MB local-analysis limit.';$('upload-error').hidden=false;return;}const reader=new FileReader();reader.onload=()=>process(reader.result,file.name);reader.readAsText(file);});
  ['dragenter','dragover'].forEach(ev=>$('drop-zone').addEventListener(ev,e=>{e.preventDefault();$('drop-zone').classList.add('drag')}));['dragleave','drop'].forEach(ev=>$('drop-zone').addEventListener(ev,e=>{e.preventDefault();$('drop-zone').classList.remove('drag')}));$('drop-zone').addEventListener('drop',e=>{const file=e.dataTransfer.files[0];if(file){const reader=new FileReader();reader.onload=()=>process(reader.result,file.name);reader.readAsText(file);}}); $('demo-button').addEventListener('click',()=>process(sample,'customer_health_sample.csv')); $('new-button').addEventListener('click',()=>{$('start').scrollIntoView({behavior:'smooth'});$('file-input').click();}); $('download-button').addEventListener('click',()=>{if(!latestReport)return;const blob=new Blob([JSON.stringify(latestReport,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`datalens-report-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);});
})();
