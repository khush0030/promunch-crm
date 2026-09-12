// Optional storefront cart action. The shopper explicitly sends the prefilled
// WhatsApp message; opening WhatsApp alone never triggers a bot reply.
export function buildCartRequestEmbed(appOrigin: string): string {
  return `(function(){
  if(window.__pmCartRequest)return;window.__pmCartRequest=true;
  if(!/\\/cart\\/?$/.test(location.pathname))return;
  function mount(){
    if(document.getElementById("pm-cart-request"))return;
    var host=document.querySelector('main form[action$="/cart"],main form[action$="/cart/"]')||document.querySelector("main");
    if(!host)return;
    var panel=document.createElement("div");panel.id="pm-cart-request";
    if(!document.getElementById("pm-cart-request-style")){
      var style=document.createElement("style");style.id="pm-cart-request-style";
      style.textContent="#pm-cart-request{box-sizing:border-box;margin:24px 0 8px;padding:20px;border:1px solid #e6e3de;border-radius:16px;background:#fff;color:#202521;font-family:inherit;text-align:left}#pm-cart-request *{box-sizing:border-box}#pm-cart-request .pm-cart-title{margin:0;font-family:inherit;font-size:18px;font-weight:700;line-height:1.3;letter-spacing:-.3px;text-transform:none;color:#202521}#pm-cart-request .pm-cart-note{margin:5px 0 16px;font-size:14px;line-height:1.5;letter-spacing:0;color:#68716a}#pm-cart-request .pm-cart-button{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:48px;margin:0;padding:12px 18px;border:1px solid #16633c;border-radius:10px;background:#16633c;color:#fff;font-family:inherit;font-size:15px;font-weight:600;line-height:1.4;letter-spacing:0;text-transform:none;cursor:pointer;box-shadow:none;transition:background .15s,border-color .15s}#pm-cart-request .pm-cart-button:before,#pm-cart-request .pm-cart-button:after{display:none}#pm-cart-request .pm-cart-button:hover{background:#104e2e;border-color:#104e2e}#pm-cart-request .pm-cart-button:focus-visible{outline:3px solid #93cfad;outline-offset:3px}#pm-cart-request .pm-cart-button:disabled{opacity:.65;cursor:wait}#pm-cart-request .pm-cart-button svg{width:20px;height:20px;flex-shrink:0}#pm-cart-request .pm-cart-help{margin:10px 0 0;font-size:12px;line-height:1.5;letter-spacing:0;color:#68716a;text-align:center}#pm-cart-request .pm-cart-status{margin:12px 0 0;font-size:13px;line-height:1.5;letter-spacing:0;color:#344e3e}#pm-cart-request .pm-cart-status:empty{display:none}@media(min-width:700px){#pm-cart-request{display:grid;grid-template-columns:1fr auto;column-gap:28px;align-items:center;padding:22px 24px}#pm-cart-request .pm-cart-copy{grid-column:1;grid-row:1 / 3}#pm-cart-request .pm-cart-note{margin-bottom:0}#pm-cart-request .pm-cart-button{grid-column:2;grid-row:1;min-width:190px}#pm-cart-request .pm-cart-help{grid-column:2;grid-row:2}#pm-cart-request .pm-cart-status{grid-column:1 / -1}}@media(prefers-reduced-motion:reduce){#pm-cart-request .pm-cart-button{transition:none}}";
      document.head.appendChild(style);
    }
    var copy=document.createElement("div");copy.className="pm-cart-copy";
    var title=document.createElement("h3");title.className="pm-cart-title";title.textContent="Take your cart with you";
    var note=document.createElement("p");note.className="pm-cart-note";note.textContent="Get your cart link on WhatsApp.";
    copy.appendChild(title);copy.appendChild(note);
    var button=document.createElement("button");button.type="button";button.className="pm-cart-button";button.setAttribute("aria-label","Send my cart to WhatsApp");
    button.innerHTML='<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20.5 11.7a8.5 8.5 0 0 1-12.6 7.5L3 20.5l1.3-4.8A8.5 8.5 0 1 1 20.5 11.7Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8.2 7.8c-.6.5-.6 1.3-.3 2.1 1 2.4 2.8 4.2 5.2 5.1.8.3 1.5.2 2-.3l.8-1-2.3-1.2-.8.8a7.4 7.4 0 0 1-2.6-2.6l.7-.9-1.2-2.3-.8.3Z" fill="currentColor"/></svg><span>Send my cart</span>';
    var help=document.createElement("p");help.className="pm-cart-help";help.textContent="Press Send in WhatsApp. No marketing signup.";
    var status=document.createElement("p");status.className="pm-cart-status";status.setAttribute("role","status");status.setAttribute("aria-live","polite");
    panel.appendChild(copy);panel.appendChild(button);panel.appendChild(help);panel.appendChild(status);host.appendChild(panel);
    button.onclick=async function(){
      button.disabled=true;button.setAttribute("aria-busy","true");status.textContent="Preparing your cart…";
      try{
        var root=window.Shopify&&window.Shopify.routes&&window.Shopify.routes.root||"/";
        var r=await fetch(root+"cart.js",{credentials:"same-origin",cache:"no-store"});
        if(!r.ok)throw Error("cart");
        var cart=await r.json();
        var items=(cart.items||[]).map(function(i){return{variant_id:i.variant_id,quantity:i.quantity,properties:i.properties,selling_plan_allocation:i.selling_plan_allocation?true:null,parent_relationship:i.parent_relationship?true:null,item_components:i.item_components&&i.item_components.length?[true]:[]}});
        var response=await fetch(${JSON.stringify(appOrigin + "/api/public/wa-cart-request")},{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items:items})});
        var result=await response.json();
        if(!response.ok||!result.url||!/^https:\\/\\/wa\\.me\\/\\d+\\?text=/.test(result.url))throw Error("request");
        status.textContent="Press Send in WhatsApp to receive your cart link.";
        location.assign(result.url);
      }catch(e){status.textContent="We could not prepare this cart link. You can still use checkout on this page or chat with us for help.";}
      finally{button.disabled=false;button.removeAttribute("aria-busy");}
    };
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount);else mount();
  var timer;new MutationObserver(function(){clearTimeout(timer);timer=setTimeout(mount,200)}).observe(document.documentElement,{childList:true,subtree:true});
})();`;
}
