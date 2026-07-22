const form = document.querySelector('#loginForm');
const err = document.querySelector('#err');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  const user = document.querySelector('#user').value;
  const password = document.querySelector('#password').value;
  try {
    const r = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, password }),
    });
    if (r.ok) {
      location.href = '/dashboard.html';
    } else {
      const d = await r.json().catch(() => ({}));
      err.textContent = d.error || 'Usuario o clave incorrectos.';
    }
  } catch {
    err.textContent = 'No se pudo conectar. Probá de nuevo.';
  }
});
