/* Presentation enhancements for editable writing areas and illustrative costs. */
window.enhancePremium = () => {
  document.querySelectorAll('textarea:not(#maya-question):not(#cx-reply):not(#er-message)').forEach((area, index) => {
    const label = area.closest('label');
    const title = label?.firstChild?.textContent.trim() || 'Message';
    area.id ||= 'writing-area-' + index;
    area.setAttribute('aria-label', title);
    const shell = document.createElement('div');
    shell.className = 'writing-surface';
    area.before(shell);
    const header = document.createElement('div');
    header.className = 'writing-header';
    const name = document.createElement('span');
    name.textContent = /question/i.test(title) ? 'Ask about your business' : /guidance/i.test(title) ? 'Draft instructions' : /note/i.test(title) ? 'Internal note' : 'Write a reply';
    header.append(name);
    const hint = document.createElement('span');
    hint.textContent = 'Draft';
    hint.setAttribute('aria-hidden', 'true');
    header.append(hint);
    shell.append(header, area);
    area.placeholder ||= /question/i.test(title) ? 'What would you like to understand?' : 'Start writing here…';
    const footer = document.createElement('div');
    footer.className = 'writing-footer';
    const mode = document.createElement('span');
    mode.textContent = /guidance|question|note/i.test(title) ? 'Only visible to your team' : 'Draft · Review before sending';
    const count = document.createElement('span');
    footer.append(mode, count);
    shell.append(footer);
    const update = () => {
      count.textContent = area.value.length + ' characters';
      area.style.height = 'auto';
      area.style.height = Math.min(380, Math.max(120, area.scrollHeight)) + 'px';
    };
    area.addEventListener('input', update);
    update();
  });
  if (document.querySelector('#cost-visual')) {
    const fields = [...document.querySelectorAll('.cost-input-grid input[type=number]')];
    fields.forEach(f => { f.min = '0'; f.step = '.01'; });
    const draw = () => {
      const valid = fields.every(f => f.value.trim() !== '' && Number.isFinite(Number(f.value)) && Number(f.value) >= 0);
      const host = document.querySelector('#cost-visual');
      const profitLabel = document.querySelector('#unit-profit');
      const marginLabel = document.querySelector('#unit-margin');
      if (!valid) { host.textContent = 'Enter both costs to calculate contribution.'; profitLabel.textContent = 'Not calculated'; marginLabel.textContent = 'Cost required'; marginLabel.className = 'badge amber'; return; }
      const [cost, pack] = fields.map(f => Number(f.value));
      const profit = 500 - cost - pack - 120;
      const rupee = n => (n < 0 ? '−' : '') + '₹' + Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
      profitLabel.textContent = rupee(profit);
      profitLabel.classList.toggle('is-loss', profit < 0);
      marginLabel.textContent = (profit / 5).toFixed(1) + '% margin';
      marginLabel.className = 'badge ' + (profit < 0 ? 'red' : 'green');
      const rows = [['Product cost',cost,'product-cost'],['Packaging',pack,'packaging-cost'],['Amazon fees',120,'fee-cost'],[profit < 0 ? 'Loss' : 'Contribution',profit,profit < 0 ? 'loss-cost' : 'profit-cost']];
      const scale = Math.max(500, cost + pack + 120);
      host.innerHTML = '<div class="cost-segments" aria-hidden="true">' + rows.filter(r => r[1] > 0).map(([,n,c]) => `<span class="${c}" style="flex:${n}"></span>`).join('') + '</div>' + rows.map(([label,n,c]) => `<div class="cost-line ${c}"><span class="cost-dot"></span><div><b>${label}</b><small>${(n / 5).toFixed(1)}% of selling price</small></div><strong>${rupee(n)}</strong><div class="cost-line-track"><i style="width:${Math.min(100,Math.abs(n)/scale*100)}%"></i></div></div>`).join('');
    };
    fields.forEach(f => f.addEventListener('input', draw));
    draw();
  }
};
