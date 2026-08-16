const { app, BrowserWindow, nativeImage } = require('electron')
const fs = require('fs')
const path = require('path')

app.disableHardwareAcceleration()

function buildIco(pngs, sizes) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(sizes.length, 4)
  const directory = Buffer.alloc(16 * sizes.length)
  let offset = header.length + directory.length
  const blobs = []
  sizes.forEach((size, index) => {
    const png = pngs[index]
    const width = size >= 256 ? 0 : size
    const base = index * 16
    directory.writeUInt8(width, base)
    directory.writeUInt8(width, base + 1)
    directory.writeUInt8(0, base + 2)
    directory.writeUInt8(0, base + 3)
    directory.writeUInt16LE(1, base + 4)
    directory.writeUInt16LE(32, base + 6)
    directory.writeUInt32LE(png.length, base + 8)
    directory.writeUInt32LE(offset, base + 12)
    offset += png.length
    blobs.push(png)
  })
  return Buffer.concat([header, directory, ...blobs])
}

app.whenReady().then(async () => {
  try {
    const svg = fs.readFileSync(path.join(__dirname, '..', 'assets', 'icon.svg'), 'utf8')
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
    const win = new BrowserWindow({
      width: 256,
      height: 256,
      show: false,
      transparent: true,
      frame: false,
      webPreferences: { offscreen: true },
    })
    await win.loadURL(url)
    await new Promise(resolve => setTimeout(resolve, 800))
    const image = await win.webContents.capturePage()
    const base = image.toPNG()
    const sizes = [256, 128, 64, 48, 32, 16]
    const pngs = sizes.map(size => {
      const resized = nativeImage.createFromBuffer(base).resize({ width: size, height: size, quality: 'best' })
      return resized.toPNG()
    })
    const assetDir = path.join(__dirname, '..', 'assets')
    fs.writeFileSync(path.join(assetDir, 'icon.png'), base)
    fs.writeFileSync(path.join(assetDir, 'icon.ico'), buildIco(pngs, sizes))
    console.log('ICON_RENDER_OK')
  } catch (error) {
    console.error('ICON_RENDER_FAILED', error)
    process.exitCode = 1
  } finally {
    app.quit()
  }
})
