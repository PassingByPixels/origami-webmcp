# Origami — one file, every tool

**Live at [origami.gratis](https://origami.gratis).**

Origami documents are single self-contained `.origami.html` files — a deck, a document, a
sketch, a chart, a roadmap. Double-click one and it plays; the renderer travels inside the
file. Nothing to install, nothing uploaded: every tool on the site runs entirely in your tab.

Every page is also an **agent-first [WebMCP](https://github.com/webmachinelearning/webmcp)
app**: the page hands its authoring tools to any agent in the browser. Folio registers 29
tools; Draw, Charts and Gantt register their own scoped sets. A human can drive the same
tools by hand from the built-in console — same registry, same code path.

```js
document.modelContext.registerTool({
  name: "add_chunk",
  description: "Add a new fold to the open document",
  inputSchema: { /* JSON Schema */ },
  execute: async (input) => { /* one validated write gate */ },
});
```

## Source

The full source of the site and its WebMCP tool surface lands in this repository shortly —
it is being prepared for release. Until then, the finished product is live at
[origami.gratis](https://origami.gratis), where you can watch an agent build a deck from
the landing page.

## License

[AGPL-3.0](LICENSE). The repository will vendor compiled `@origami` runtime artifacts —
the same bytes embedded in every saved `.origami.html` file — under a separate notice in
`vendor/`.
