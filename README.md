# Graph Algorithm Practice

An interactive browser-based tool for building directed weighted graphs and visualizing classic graph search algorithms step by step.

The app is a static HTML/CSS/JavaScript project. It does not require a build step, package install, or backend server.

## Features

- Draw directed graphs by adding nodes and connecting them with weighted edges.
- Mark one or more nodes as goals.
- Assign heuristic values to nodes for informed search algorithms.
- Generate random graphs at easy, normal, or hard difficulty.
- Run and step through:
  - Breadth-First Search (BFS)
  - Depth-First Search (DFS)
  - Depth-Limited DFS
  - Iterative Deepening DFS (IDDFS)
  - Uniform Cost Search (UCS)
  - Greedy Best-First Search
  - A* Search
- Inspect the frontier/open list, developed nodes, graph state, and generated search tree during playback.
- Use playback controls to move forward, backward, or auto-play the recorded search steps.

## Project Structure

```text
.
+-- index.html        # App markup and D3 CDN include
+-- src/
|   +-- app.js        # Graph model, search algorithms, editor, and visualization logic
+-- styles/
    +-- main.css      # Application layout and visual styling
```

## Requirements

- A modern web browser.
- Internet access when loading the page, because D3 is loaded from `https://d3js.org/d3.v7.min.js`.

No local Node.js dependencies are used.

## Running Locally

You can open `index.html` directly in a browser.

For a more browser-like local environment, serve the folder with any static file server:

```powershell
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Basic Usage

1. Open the app.
2. Use **Random Graph** to start with a generated graph, or click the canvas to create your own nodes.
3. Use **Select** mode to move, edit, delete, or set nodes as the start node.
4. Use **Connect** mode to draw directed edges between nodes.
5. Set at least one goal node.
6. Choose an algorithm from the sidebar.
7. For Depth-Limited DFS, set the depth limit.
8. Click **Run Algorithm**.
9. Use the playback controls to inspect each step.

## Interaction Notes

- Node labels are short, intended for compact display inside graph nodes.
- Edge weights are non-negative numbers.
- Heuristic values are used by Greedy Best-First Search and A*.
- BFS and DFS use depth as the displayed value.
- UCS orders the frontier by path cost `g`.
- Greedy Best-First Search orders the frontier by heuristic `h`.
- A* orders the frontier by `f = g + h`.
- The graph is stored only in memory; refreshing the page resets the current graph.

## Development Notes

This project is intentionally lightweight:

- `index.html` contains the application shell and controls.
- `src/app.js` contains the graph data model, algorithm runners, random graph generation, D3 rendering, editor interactions, and playback logic.
- `styles/main.css` contains the full UI theme and responsive layout.

There is currently no automated test suite or bundler configured.

## Troubleshooting

If the page opens but the graph does not render, check that the browser can load D3 from the CDN. If you need offline usage, download D3 locally and update the script tag in `index.html`.

If running through `file://` behaves differently in your browser, use the local server command above.
