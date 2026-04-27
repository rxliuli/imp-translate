import { PNG } from 'pngjs'
import fs from 'fs'
import path from 'path'

const sizes = [16, 32, 48, 96, 128]
const iconDir = path.resolve('public/icon')

for (const size of sizes) {
  const src = path.join(iconDir, `${size}.png`)
  const dst = path.join(iconDir, 'active', `${size}-active.png`)

  const png = PNG.sync.read(fs.readFileSync(src))

  const dotRadius = Math.max(Math.round(size * 0.18), 2)
  const cx = size - dotRadius - 1
  const cy = size - dotRadius - 1
  const borderWidth = Math.max(1, Math.round(dotRadius * 0.25))

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx
      const dy = y - cy
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist <= dotRadius) {
        const idx = (y * size + x) * 4
        if (dist > dotRadius - borderWidth) {
          // darker green border
          png.data[idx] = 22
          png.data[idx + 1] = 163
          png.data[idx + 2] = 74
          png.data[idx + 3] = 255
        } else {
          // bright green fill
          png.data[idx] = 34
          png.data[idx + 1] = 197
          png.data[idx + 2] = 94
          png.data[idx + 3] = 255
        }
      }
    }
  }

  fs.writeFileSync(dst, PNG.sync.write(png))
  console.log(`Generated ${dst}`)
}
