// Applies the saved theme before the app loads (external file so the CSP needs no inline scripts). Light, the
// purple and white look, is the default.
try {
  var th = localStorage.getItem('quantly.admin.theme');
  document.documentElement.dataset.theme = th === 'dark' ? 'dark' : 'light';
} catch (e) {
  document.documentElement.dataset.theme = 'light';
}
