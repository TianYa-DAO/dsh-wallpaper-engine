import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { packager } from '@electron/packager'

const dir = resolve(process.argv[2] ?? process.cwd())
const electronDist = resolve(process.env.DSH_ELECTRON_DIST ?? join(dir, 'node_modules', 'electron', 'dist'))
const electronPackage = await readFile(join(electronDist, '..', 'package.json'), 'utf8')
const electronVersion = JSON.parse(electronPackage).version

const zipDir = join(tmpdir(), 'dsh-electron-zips')
await mkdir(zipDir, { recursive: true })
const zipFile = join(zipDir, `electron-v${electronVersion}-win32-x64.zip`)
if (!(await exists(zipFile))) {
  const archive = spawnSync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    `Compress-Archive -Path '${electronDist}\\*' -DestinationPath '${zipFile}' -Force`,
  ], { stdio: 'inherit' })
  if (archive.status !== 0) throw new Error('DSH_ELECTRON_ZIP_FAILED')
}

const staging = await mkdtemp(join(tmpdir(), 'dsh-desktop-packaging-'))
try {
  await cp(join(dir, 'dist'), join(staging, 'dist'), { recursive: true })
  await cp(join(dir, 'assets'), join(staging, 'assets'), { recursive: true })
  await writeFile(join(staging, 'package.json'), JSON.stringify({
    name: 'dsh-wallpaper-engine-desktop',
    productName: 'DeepSeek Harness桌面版',
    version: '0.1.0',
    main: 'dist/main.js',
  }, null, 2), 'utf8')

  await packager({
    dir: staging,
    name: 'DeepSeek Harness桌面版',
    platform: 'win32',
    arch: 'x64',
    out: resolve(dir, 'release'),
    overwrite: true,
    icon: resolve(dir, 'assets', 'icon.ico'),
    asar: true,
    electronVersion,
    electronZipDir: zipDir,
    win32metadata: {
      CompanyName: 'DeepSeek',
      FileDescription: 'DeepSeek Harness桌面版',
      OriginalFilename: 'DeepSeek Harness桌面版.exe',
      ProductName: 'DeepSeek Harness桌面版',
      InternalName: 'DeepSeek Harness桌面版',
    },
  })
  console.log('packaged into', resolve(dir, 'release'))
} finally {
  await rm(staging, { recursive: true, force: true })
}

async function exists(file) {
  try {
    await import('node:fs/promises').then(({ access }) => access(file))
    return true
  } catch {
    return false
  }
}
