export function addStyle(shadow: ShadowRoot, styles: string[]) {
  const style = document.createElement('style')
  style.textContent = styles.join('\n').replaceAll(':root', ':host')
  if (shadow.firstChild) {
    shadow.insertBefore(style, shadow.firstChild)
  } else {
    shadow.appendChild(style)
  }
}
