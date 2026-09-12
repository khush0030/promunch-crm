// Optional storefront cart action. The shopper explicitly sends the prefilled
// WhatsApp message; opening WhatsApp alone never triggers a bot reply.
export function buildCartRequestEmbed(appOrigin: string): string {
  return `(function(){
  if(window.__pmCartRequest)return;window.__pmCartRequest=true;
  if(!/\\/cart\\/?$/.test(location.pathname))return;
  function mount(){
    if(document.getElementById("pm-cart-request"))return;
    var host=document.querySelector('form[action$="/cart"],form[action$="/cart/"]')||document.querySelector("main");
    if(!host)return;
    var panel=document.createElement("div");panel.id="pm-cart-request";
    panel.style.cssText="margin:16px 0;padding:16px;border:1px solid #d5dfd3;border-radius:12px;background:#f5faf3;color:#25352b;font-family:inherit";
    var button=document.createElement("button");button.type="button";button.textContent="Send my cart to WhatsApp";
    button.style.cssText="padding:12px 18px;border:0;border-radius:8px;background:#176b40;color:white;font:inherit;font-weight:600;cursor:pointer";
    var note=document.createElement("p");note.style.cssText="margin:8px 0 0;font-size:13px;line-height:1.5";
    note.textContent="Open WhatsApp, then press Send to request your cart link. Prices and offers are checked when you return. This does not subscribe you to marketing.";
    var status=document.createElement("p");status.setAttribute("role","status");status.style.cssText="margin:8px 0 0;font-size:13px";
    panel.appendChild(button);panel.appendChild(note);panel.appendChild(status);host.appendChild(panel);
    button.onclick=async function(){
      button.disabled=true;status.textContent="Preparing your cart…";
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
      finally{button.disabled=false;}
    };
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount);else mount();
  var timer;new MutationObserver(function(){clearTimeout(timer);timer=setTimeout(mount,200)}).observe(document.documentElement,{childList:true,subtree:true});
})();`;
}
