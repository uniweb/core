/**
 * Insets — lifted out of a content document at render-graph construction.
 *
 * A leaf module so a tool can show exactly what a component receives without building
 * a Block: `uniweb inspect` imports it. `Block`'s constructor is the one runtime caller.
 */

/**
 * Lift the insets out of a content document — both forms, as the author wrote them.
 *
 * - A LEAF inset — `![alt](@Component){params}`, `[text](@Component)`, and the
 *   `[@key]` / `[#id]` shorthands — parses to an `inset_ref` node. It becomes an
 *   `inset_placeholder` in place, inline where it was inline, and a leaf ref:
 *   the component, its params, and the `[…]` text as the inset's title.
 * - A CONTAINER — a ` ```@Component{params} ` fence — parses to an `inset_block`
 *   node carrying a body of real block content. It becomes a placeholder too, and
 *   its body becomes the child Block's content.
 *
 * Both then resolve through one path: `getInset(refId)` → a Block → the
 * foundation's component. Kit and the SSR renderer handle placeholders, so neither
 * needs to know which form a placeholder came from.
 *
 * ⭐ Doing it HERE, at render-graph construction, is the point: what the author wrote
 * is the stored shape. `blockData.content` is shared with the sync / pull machinery
 * and an editor, which keep seeing `inset_ref` and `inset_block`, and a document that
 * never went through a build — a record body, a free-form translation — resolves its
 * insets the same way. ⛔ *Until 2026-09-27 only containers were lifted here; leaf
 * insets were extracted by the site build into the section's `insets[]`, so any
 * document the build did not extract rendered none of them.* `leafStart` offsets the
 * leaves' refIds for a caller that numbers other insets first.
 *
 * PURE with respect to the input: nodes on the path to an inset are cloned; everything
 * else is passed through by reference, so a document with no insets costs one walk and
 * allocates nothing.
 *
 * Containers are NOT recursed into here — neither for containers nor for leaves. A
 * container's body becomes its child Block's content, and that Block's constructor
 * lifts its own — so nesting resolves one level at a time, each at the level that owns
 * it.
 *
 * @param {Object} content - ProseMirror document (never mutated)
 * @param {number} [leafStart=0] - the first leaf refId number (`inset_<leafStart>`)
 * @returns {{
 *   content: Object,
 *   leaves: Array<{refId, type, params, title, embedKind}>,
 *   containers: Array<{refId, type, params, content}>,
 * }}
 */
export function liftInsets(content, leafStart = 0) {
  if (!content || !Array.isArray(content.content)) return { content, leaves: [], containers: [] }

  const leaves = []
  const containers = []

  const visit = (nodes) => {
    let changed = false
    const out = nodes.map((node) => {
      if (!node) return node

      if (node.type === 'inset_ref') {
        const { component, alt, embedKind, ...params } = node.attrs || {}
        const refId = `inset_${leafStart + leaves.length}`
        const kind = embedKind || 'visual'
        leaves.push({ refId, type: component, params, title: alt || null, embedKind: kind })
        changed = true
        return { type: 'inset_placeholder', attrs: { refId, embedKind: kind } }
      }

      if (node.type === 'inset_block') {
        const { component, ...params } = node.attrs || {}
        const refId = `container_${containers.length}`
        containers.push({
          refId,
          type: component,
          params,
          content: { type: 'doc', content: node.content || [] },
        })
        changed = true
        return { type: 'inset_placeholder', attrs: { refId, embedKind: 'block' } }
      }

      if (Array.isArray(node.content)) {
        const inner = visit(node.content)
        if (inner !== node.content) {
          changed = true
          return { ...node, content: inner }
        }
      }
      return node
    })
    return changed ? out : nodes
  }

  const next = visit(content.content)
  return next === content.content
    ? { content, leaves, containers }
    : { content: { ...content, content: next }, leaves, containers }
}
