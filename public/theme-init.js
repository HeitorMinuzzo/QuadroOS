// Applies the saved theme before the first paint so a dark session never flashes white.
// Light is the default; see src/lib/theme.ts for the runtime side.
;(function () {
  try {
    var preference = localStorage.getItem('quadroos:theme')
    var dark =
      preference === 'dark' ||
      (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    var root = document.documentElement
    root.dataset.theme = dark ? 'dark' : 'light'
    root.classList.toggle('dark', dark)
    root.style.colorScheme = dark ? 'dark' : 'light'
  } catch (error) {
    document.documentElement.dataset.theme = 'light'
  }
})()
