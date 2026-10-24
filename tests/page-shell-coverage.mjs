// What `pageShellFingerprint` leaves unexecuted in `page-shell.js` and `data-script.js` — V8's own
// block coverage, taken in a process of its own so nothing else has run the shell first. Prints a
// JSON list of `<file>: <source text>`, one entry per range that ran zero times.
//
// Run by `page-shell.test.js`: node tests/page-shell-coverage.mjs <file URL of page-shell.js>
import inspector from 'node:inspector/promises'
import { readFileSync } from 'node:fs'

const session = new inspector.Session()
session.connect()
await session.post('Profiler.enable')
await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true })

const { pageShellFingerprint } = await import(process.argv[2])
pageShellFingerprint()

const { result } = await session.post('Profiler.takePreciseCoverage')
const unexecuted = []
for (const script of result) {
  const file = script.url.match(/\/(page-shell|data-script)\.js$/)?.[1]
  if (!file) continue
  const source = readFileSync(new URL(script.url), 'utf8')
  for (const fn of script.functions) {
    for (const range of fn.ranges) {
      if (range.count === 0) unexecuted.push(`${file}.js: ${source.slice(range.startOffset, range.endOffset)}`)
    }
  }
}
console.log(JSON.stringify(unexecuted))
