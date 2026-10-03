// A reader for Endless Sky's data file format (see source/DataFile.cpp in the
// game): one node per line, its tokens separated by white-space, quoted with
// "double quotes" or `back-ticks` when they contain spaces, and children
// nested beneath it by deeper indentation. '#' starts a comment.

import { readFileSync } from 'node:fs'

/** @typedef {{ tokens: string[], children: DataNode[], file: string, line: number }} DataNode */

/**
 * Split one line (already stripped of its indentation) into tokens.
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  const tokens = []
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === ' ' || c === '\t') {
      ++i
      continue
    }
    if (c === '#') break
    if (c === '"' || c === '`') {
      const end = text.indexOf(c, i + 1)
      tokens.push(text.slice(i + 1, end < 0 ? text.length : end))
      i = end < 0 ? text.length : end + 1
      continue
    }
    let end = i
    while (end < text.length && text[end] !== ' ' && text[end] !== '\t') ++end
    tokens.push(text.slice(i, end))
    i = end
  }
  return tokens
}

/**
 * Parse a data file into its top-level nodes.
 * @param {string} path
 * @returns {DataNode[]}
 */
export function parseDataFile(path) {
  return parseData(readFileSync(path, 'utf8'), path)
}

/**
 * Parse data-file text, as from a file named `file`.
 * @param {string} text
 * @param {string} [file]
 * @returns {DataNode[]}
 */
export function parseData(text, file = '') {
  const lines = text.split('\n')
  /** @type {DataNode} */
  const root = { tokens: [], children: [], file, line: 0 }
  /** @type {{ indent: number, node: DataNode }[]} */
  const stack = [{ indent: -1, node: root }]

  lines.forEach((raw, index) => {
    const line = raw.replace(/\r$/, '')
    let indent = 0
    while (indent < line.length && (line[indent] === '\t' || line[indent] === ' ')) ++indent
    const tokens = tokenize(line.slice(indent))
    if (!tokens.length) return

    while (stack[stack.length - 1].indent >= indent) stack.pop()
    /** @type {DataNode} */
    const node = { tokens, children: [], file, line: index + 1 }
    stack[stack.length - 1].node.children.push(node)
    stack.push({ indent, node })
  })
  return root.children
}
