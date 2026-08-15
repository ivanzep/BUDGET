export function openModal(innerHtml, { wide = false } = {}) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal ${wide ? 'modal-wide' : ''}">
        <button class="modal-close" aria-label="Close">&times;</button>
        <div class="modal-body">${innerHtml}</div>
      </div>
    </div>
  `;
  root.querySelector('.modal-close').addEventListener('click', closeModal);
  root.querySelector('.modal-backdrop').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-backdrop')) closeModal();
  });
  return root.querySelector('.modal-body');
}

export function closeModal() {
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
}
