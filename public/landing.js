async function initialize() {
  try {
    const response = await fetch('/api/auth/status');
    const status = await response.json();
    const primary = document.querySelector('#primaryLogin');
    const demo = document.querySelector('#demoLogin');
    const note = document.querySelector('#authNote');
    if (status.authenticated) {
      primary.textContent = 'Open dashboard';
      primary.href = '/app.html';
      note.textContent = status.demoMode ? 'Demo mode is enabled for this environment.' : `Signed in as ${status.user?.email || 'your account'}.`;
    } else if (!status.googleEnabled) {
      primary.classList.add('hidden');
      note.textContent = 'Google OAuth is not configured. Enable DEMO_MODE or add Google OAuth credentials.';
    }
    if (status.demoMode) demo.classList.remove('hidden');
  } catch (error) {
    document.querySelector('#authNote').textContent = `Unable to check sign-in status: ${error.message}`;
  }
}
initialize();
