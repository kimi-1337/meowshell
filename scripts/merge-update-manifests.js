'use strict'

const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')

const ARCHITECTURES = ['x64', 'arm64']

function safeSha512(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(value)) return false
  try { return Buffer.from(value, 'base64').length === 64 } catch { return false }
}

function architectureFromUrl(value) {
  const url = String(value || '')
  const name = path.posix.basename(url.replace(/\\/g, '/'))
  const match = name.match(/-win-(x64|arm64)-setup\.exe$/i)
  return match ? match[1].toLowerCase() : ''
}

function prereleaseChannel(version) {
  const match = String(version || '').match(/^[0-9]+\.[0-9]+\.[0-9]+-([0-9A-Za-z-]+)/)
  return match ? match[1].toLowerCase() : 'latest'
}

function mergeUpdateManifests(documents) {
  if (!Array.isArray(documents) || documents.length < 2) throw new Error('At least two update manifests are required')
  const versions = new Set()
  const releases = []
  const filesByArch = new Map()

  for (const document of documents) {
    if (!document || typeof document !== 'object') throw new Error('Update manifest must be an object')
    const version = String(document.version || '')
    if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Invalid update version: ' + version)
    versions.add(version)
    if (document.releaseDate && !Number.isNaN(Date.parse(document.releaseDate))) releases.push(String(document.releaseDate))
    if (!Array.isArray(document.files)) throw new Error('Update manifest has no files array')

    for (const file of document.files) {
      const arch = architectureFromUrl(file && file.url)
      if (!arch) continue
      const url = String(file.url)
      if (url !== path.posix.basename(url) || !safeSha512(file.sha512) || !Number.isSafeInteger(file.size) || file.size <= 0) {
        throw new Error('Invalid ' + arch + ' installer metadata')
      }
      if (filesByArch.has(arch)) throw new Error('Duplicate ' + arch + ' installer metadata')
      filesByArch.set(arch, { url, sha512: file.sha512, size: file.size })
    }
  }

  if (versions.size !== 1) throw new Error('Architecture manifests contain different versions')
  for (const arch of ARCHITECTURES) if (!filesByArch.has(arch)) throw new Error('Missing ' + arch + ' installer metadata')
  const files = ARCHITECTURES.map((arch) => filesByArch.get(arch))
  const fallback = files[0]
  const result = {
    version: [...versions][0],
    files,
    path: fallback.url,
    sha512: fallback.sha512,
  }
  if (releases.length) result.releaseDate = releases.sort().at(-1)
  return result
}

function readManifest(file) {
  const stat = fs.statSync(file)
  if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Invalid update manifest file: ' + file)
  return yaml.load(fs.readFileSync(file, 'utf8'), { json: true })
}

function writeMergedManifests(inputFiles, outputFile) {
  const merged = mergeUpdateManifests(inputFiles.map(readManifest))
  const serialized = yaml.dump(merged, { lineWidth: -1, noRefs: true })
  fs.writeFileSync(outputFile, serialized, 'utf8')
  const channel = prereleaseChannel(merged.version)
  if (channel !== 'latest') {
    if (!/^[a-z0-9-]{1,32}$/.test(channel)) throw new Error('Invalid prerelease update channel')
    fs.writeFileSync(path.join(path.dirname(outputFile), channel + '.yml'), serialized, 'utf8')
  }
  return { outputFile, channel, manifest: merged }
}

if (require.main === module) {
  const [first, second, output] = process.argv.slice(2)
  if (!first || !second || !output) {
    console.error('Usage: node scripts/merge-update-manifests.js <x64.yml> <arm64.yml> <output.yml>')
    process.exitCode = 2
  } else {
    try {
      const result = writeMergedManifests([first, second], output)
      console.log('Created ' + output + ' for ' + result.manifest.version + ' (' + result.channel + ')')
    } catch (error) {
      console.error(error.message)
      process.exitCode = 1
    }
  }
}

module.exports = { architectureFromUrl, mergeUpdateManifests, prereleaseChannel, safeSha512, writeMergedManifests }
