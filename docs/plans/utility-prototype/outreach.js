window.bindOutreach = () => {
  const sectors = [...document.querySelectorAll('[data-sector]')];
  if (sectors.length) {
    sectors.forEach(button => button.onclick = () => {
      sectors.forEach(b => b.setAttribute('aria-pressed', String(b === button)));
      document.querySelector('#brief-sector').textContent = button.dataset.sector;
    });
    bindOutreachLocation();
    [['outreach-count','brief-count'],['outreach-roles','brief-roles']].forEach(([input,id])=>{
      document.getElementById(input).addEventListener('input',event=>document.getElementById(id).textContent=event.target.value||'Not set');
    });
  }
  const list = document.querySelector('#draft-list');
  if (!list) return;
  let selected = 0;
  const drafts = [...list.querySelectorAll('details')];
  const workspace = document.createElement('div');
  workspace.className = 'review-workspace';
  const queue = document.createElement('aside');
  queue.className = 'review-queue';
  queue.setAttribute('aria-label','Company drafts');
  const progress = document.createElement('div');
  progress.className = 'review-progress';
  list.before(progress,workspace);
  workspace.append(queue,list);
  drafts.forEach((draft,i)=>{
    draft.open = true;
    const subject=draft.querySelector('input:not([type=checkbox])'), message=draft.querySelector('textarea');
    let saved;try{saved=JSON.parse(sessionStorage.getItem('outreach-draft-'+i)||'null');}catch{saved=null;}
    if(saved){subject.value=saved.subject;message.value=saved.message;}
    [subject,message].forEach(input=>input.addEventListener('input',()=>{
      sessionStorage.setItem('outreach-draft-'+i,JSON.stringify({subject:subject.value,message:message.value}));
      sessionStorage.removeItem('review-'+i);draft.querySelector('[data-review]').checked=false;updateReview();
    }));
    draft.dataset.company = draft.querySelector('summary').childNodes[0].textContent.trim().replace(/^\d+\. /,'');
    draft.querySelector('.panelbody').insertAdjacentHTML('afterbegin',`<div class="review-editor-heading"><span class="outreach-kicker">PERSONALIZED EMAIL / ${String(i+1).padStart(2,'0')}</span><h2>${draft.dataset.company}</h2><p>From Parth · parth@trypromunch.in</p></div>`);
    draft.querySelector('summary').hidden = true;
    const check = draft.querySelector('.check');
    check.classList.add('review-confirmation');
    const next = document.createElement('button');
    next.type='button';next.className='review-next';next.textContent=i===drafts.length-1?'Return to first draft ↗':'Next draft →';
    next.onclick=()=>select((i+1)%drafts.length,true);
    check.after(next);
  });
  function paintQueue(){
    const reviewed = drafts.filter(d=>d.querySelector('[data-review]').checked).length;
    progress.innerHTML=`<div><b>${reviewed} <span>of 10 reviewed</span></b><small>Review the recipient, context and claims in every draft.</small></div><progress value="${reviewed}" max="10" aria-label="Draft review progress"></progress><span class="review-remaining">${10-reviewed} remaining</span>`;
    queue.innerHTML='<div class="queue-title">COMPANIES <span>10</span></div>';
    drafts.forEach((draft,i)=>{
      const done=draft.querySelector('[data-review]').checked;
      const b=document.createElement('button');b.type='button';b.className='queue-item';b.setAttribute('aria-current',String(i===selected));
      b.innerHTML=`<span class="company-monogram">${draft.dataset.company.split(' ').map(s=>s[0]).join('')}</span><span><b>${draft.dataset.company}</b><small class="${done?'reviewed':''}">${done?'✓ Reviewed':'Needs review'}</small></span><span class="queue-arrow" aria-hidden="true">›</span>`;
      b.onclick=()=>select(i,true);queue.append(b);
    });
  }
  function select(i,focus){
    selected=i;
    drafts.forEach((d,j)=>d.hidden=i!==j);
    paintQueue();
    const area=drafts[i].querySelector('textarea');
    area.style.height='auto';area.style.height=Math.min(380,Math.max(200,area.scrollHeight))+'px';
    if(focus){const heading=drafts[i].querySelector('.review-editor-heading h2');heading.tabIndex=-1;heading.focus({preventScroll:true});if(innerWidth<800)heading.scrollIntoView({block:'start'});}
  }
  list.addEventListener('change',paintQueue);
  list.addEventListener('input',paintQueue);
  select(0,false);
};
