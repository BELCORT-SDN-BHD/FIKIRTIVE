import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

const webRoot = process.cwd()
const sourceRoots = ["app", "components"]
const skippedSegments = new Set(["__tests__", "design-system", "ui"])
const sourceExtensions = new Set([".ts", ".tsx"])

async function collectFiles(relativeDirectory) {
  const absoluteDirectory = path.join(webRoot, relativeDirectory)
  const entries = await readdir(absoluteDirectory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const relativePath = path.join(relativeDirectory, entry.name)

      if (entry.isDirectory()) {
        if (skippedSegments.has(entry.name)) return []
        return collectFiles(relativePath)
      }

      return sourceExtensions.has(path.extname(entry.name)) ? [relativePath] : []
    }),
  )

  return nested.flat()
}

const files = (await Promise.all(sourceRoots.map(collectFiles))).flat()
const usageByComponent = new Map()
const adoptingFiles = new Set()
const importPattern = /from\s+["']@\/components\/ui\/([^"']+)["']/g

for (const file of files) {
  const source = await readFile(path.join(webRoot, file), "utf8")

  for (const match of source.matchAll(importPattern)) {
    const component = match[1]
    const consumers = usageByComponent.get(component) ?? new Set()
    consumers.add(file)
    usageByComponent.set(component, consumers)
    adoptingFiles.add(file)
  }
}

const components = [...usageByComponent.entries()]
  .map(([component, consumers]) => ({ component, files: consumers.size }))
  .sort((left, right) => right.files - left.files || left.component.localeCompare(right.component))

const report = {
  scannedFiles: files.length,
  adoptingFiles: adoptingFiles.size,
  adoptionPercent: files.length === 0 ? 0 : Number(((adoptingFiles.size / files.length) * 100).toFixed(1)),
  components,
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`Design-system adoption: ${report.adoptingFiles}/${report.scannedFiles} product files (${report.adoptionPercent}%)`)
  console.table(report.components)
}
