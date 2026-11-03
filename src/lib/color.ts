function luminance(hex: string) {
  const value = hex.replace('#', '')
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value
  const channels = [0, 2, 4].map((i) => {
    const n = parseInt(full.slice(i, i + 2), 16) / 255
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

export function accentInk(color: string) {
  if (1.05 / (luminance(color) + 0.05) >= 4.6) return color
  const channels = color
    .replace('#', '')
    .match(/.{2}/g)
    ?.map((c) => parseInt(c, 16))
  if (!channels || channels.length !== 3) return '#53617d'
  let result = color
  for (let step = 1; step <= 10; step++) {
    result =
      '#' +
      channels
        .map((c) =>
          Math.round(c * (1 - step * 0.07))
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
    if (1.05 / (luminance(result) + 0.05) >= 4.6) return result
  }
  return result
}
