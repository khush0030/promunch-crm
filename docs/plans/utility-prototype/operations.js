/* Exact SKU listing links, saved locally for this illustrative preview. */
window.bindListings = () => {
  const valid = value => { try { const u=new URL(value); return u.protocol==='https:' && /^(www\.)?amazon\.in$/.test(u.hostname) && /^\/(?:[^/]+\/)?dp\/[A-Z0-9]{10}(?:[/?]|$)/i.test(u.pathname); } catch { return false; } };
  document.querySelectorAll('[data-listing]').forEach(host=>{
    const sku=host.dataset.listing;
    const key='prototype-amazon-listing-'+sku;
    const url=localStorage.getItem(key)||'';
    host.className='sku-listing';
    if(valid(url)){
      const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Amazon listing ↗';a.setAttribute('aria-label','Open Amazon listing for '+sku+' in a new tab');host.replaceChildren(a);
    }else host.replaceChildren();
    const edit=document.createElement('button');edit.type='button';edit.textContent=valid(url)?'Edit':'Link Amazon listing ↗';edit.setAttribute('aria-label','Set Amazon listing for '+sku);host.append(edit);
    edit.onclick=()=>{
      const dialog=document.querySelector('#dialog');
      dialog.innerHTML='<h2>Amazon listing · '+sku+'</h2><p>Paste the exact Amazon India product URL for this pack size. Saved only in this browser preview.</p><form><label class="field">Amazon product URL<input type="url" required placeholder="https://www.amazon.in/dp/…"></label><p class="listing-error" role="alert"></p><div class="row"><button type="submit" class="primary">Save listing</button><button type="button" data-cancel>Cancel</button></div></form>';
      const input=dialog.querySelector('input');input.value=url;dialog.showModal();input.focus();
      dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
      dialog.querySelector('form').onsubmit=e=>{e.preventDefault();const value=input.value.trim();if(!valid(value)){dialog.querySelector('.listing-error').textContent='Use an Amazon India product URL containing /dp/ and its 10-character ASIN.';return;}localStorage.setItem(key,value);dialog.close();window.bindListings();};
    };
  });
};
