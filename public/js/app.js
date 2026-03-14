/**
 * CodeMem Frontend Application
 * Main UI logic and interactions
 */

class CodeMemApp {
  constructor() {
    this.memories = [];
    this.graphData = null;
    this.selectedMemory = null;
    this.filters = {
      types: new Set(['decision', 'feature', 'bugfix', 'todo']),
      scope: 'repo',
      layer: '',
    };
    this.currentView = 'graph';

    this.initializeElements();
    this.setupEventListeners();
    this.loadData();
  }

  initializeElements() {
    // Canvas
    this.canvas = document.getElementById('memory-canvas');
    this.ctx = this.canvas.getContext('2d');

    // Filter inputs
    this.filterCheckboxes = {
      decision: document.getElementById('filter-decision'),
      feature: document.getElementById('filter-feature'),
      bugfix: document.getElementById('filter-bugfix'),
      todo: document.getElementById('filter-todo'),
    };
    this.scopeFilter = document.getElementById('scope-filter');
    this.layerFilter = document.getElementById('layer-filter');

    // Buttons
    this.refreshBtn = document.getElementById('refresh-btn');
    this.searchBtn = document.getElementById('search-btn');
    this.closeDetailBtn = document.getElementById('close-detail');

    // Search
    this.searchInput = document.getElementById('search-input');

    // Views
    this.viewButtons = document.querySelectorAll('.view-btn');
    this.viewContainers = document.querySelectorAll('.view-content');

    // Panels
    this.detailPanel = document.getElementById('detail-panel');
    this.loadingIndicator = document.getElementById('loading-indicator');

    // Canvas setup
    this.resizeCanvas();
    this.canvasWidth = this.canvas.width;
    this.canvasHeight = this.canvas.height;
  }

  setupEventListeners() {
    // Filter changes
    Object.values(this.filterCheckboxes).forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        if (e.target.checked) {
          this.filters.types.add(e.target.value);
        } else {
          this.filters.types.delete(e.target.value);
        }
        this.refreshView();
      });
    });

    this.scopeFilter.addEventListener('change', (e) => {
      this.filters.scope = e.target.value;
      this.loadData();
    });

    this.layerFilter.addEventListener('change', (e) => {
      this.filters.layer = e.target.value;
      this.refreshView();
    });

    // Buttons
    this.refreshBtn.addEventListener('click', () => this.loadData());
    this.searchBtn.addEventListener('click', () => this.performSearch());
    this.searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.performSearch();
    });

    // View switching
    this.viewButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.switchView(e.target.dataset.view);
      });
    });

    // Detail panel
    this.closeDetailBtn.addEventListener('click', () => this.closeDetailPanel());
    this.detailPanel.addEventListener('click', (e) => {
      if (e.target === this.detailPanel) this.closeDetailPanel();
    });

    // Canvas interactions
    this.canvas.addEventListener('click', (e) => this.handleCanvasClick(e));
    this.canvas.addEventListener('mousemove', (e) => this.handleCanvasHover(e));

    // Window resize
    window.addEventListener('resize', () => {
      this.resizeCanvas();
      if (this.currentView === 'graph' && this.graphData) {
        this.drawGraph();
      }
    });
  }

  async loadData() {
    this.showLoading(true);
    try {
      const [memories, graph, stats] = await Promise.all([
        api.getMemories({
          scope: this.filters.scope,
          limit: 200,
        }),
        api.getMemoryGraph({
          scope: this.filters.scope,
        }),
        api.getStats({
          scope: this.filters.scope,
        }),
      ]);

      this.memories = memories.data || [];
      this.graphData = graph.data || { nodes: [], edges: [] };

      // Update stats
      document.getElementById('node-count').textContent =
        `${this.memories.length} memories • ${this.graphData.nodes.length} in graph`;

      this.refreshView();
    } catch (error) {
      console.error('Failed to load data:', error);
      this.showError('Failed to load memories');
    } finally {
      this.showLoading(false);
    }
  }

  refreshView() {
    switch (this.currentView) {
      case 'graph':
        this.drawGraph();
        break;
      case 'timeline':
        this.renderTimeline();
        break;
      case 'dependencies':
        this.renderDependencies();
        break;
      case 'search':
        this.renderSearchResults();
        break;
    }
  }

  switchView(viewName) {
    // Update buttons
    this.viewButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });

    // Update views
    this.viewContainers.forEach(view => {
      view.classList.toggle('active', view.id === `${viewName}-view`);
    });

    this.currentView = viewName;
    this.refreshView();
  }

  // Graph Visualization
  drawGraph() {
    const filtered = this.getFilteredMemories();

    // Clear canvas
    this.ctx.fillStyle = '#0d1117';
    this.ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);

    if (!filtered.length) {
      this.ctx.fillStyle = '#8b949e';
      this.ctx.font = '14px sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.fillText('No memories match current filters', this.canvasWidth / 2, this.canvasHeight / 2);
      return;
    }

    // Position nodes using simple force-directed layout
    const nodes = this.layoutGraph(filtered);

    // Draw edges
    this.ctx.strokeStyle = '#30363d';
    this.ctx.lineWidth = 1;
    nodes.forEach(node => {
      node.relations?.forEach(relId => {
        const target = nodes.find(n => n.id === relId);
        if (target) {
          this.ctx.beginPath();
          this.ctx.moveTo(node.x, node.y);
          this.ctx.lineTo(target.x, target.y);
          this.ctx.stroke();
        }
      });
    });

    // Draw nodes
    nodes.forEach(node => {
      this.drawNode(node);
    });

    // Store nodes for interaction
    this.graphNodes = nodes;
  }

  layoutGraph(memories) {
    if (!this.graphNodes) {
      return memories.map((memory, i) => ({
        ...memory,
        x: Math.random() * this.canvasWidth,
        y: Math.random() * this.canvasHeight,
        vx: 0,
        vy: 0,
      }));
    }

    // Simple physics simulation
    const K = 0.5;
    const damping = 0.95;
    const repulsion = 5000;
    const attraction = 0.01;

    memories.forEach(memory => {
      const node = this.graphNodes.find(n => n.id === memory.id);
      if (!node) return;

      let fx = 0;
      let fy = 0;

      // Repulsion from other nodes
      memories.forEach(other => {
        if (other.id === memory.id) return;
        const dx = node.x - (this.graphNodes.find(n => n.id === other.id)?.x || 0);
        const dy = node.y - (this.graphNodes.find(n => n.id === other.id)?.y || 0);
        const dist = Math.sqrt(dx * dx + dy * dy) + 1;
        fx += (dx / dist) * (repulsion / (dist * dist));
        fy += (dy / dist) * (repulsion / (dist * dist));
      });

      // Keep in bounds
      if (node.x < 50) fx += 100;
      if (node.x > this.canvasWidth - 50) fx -= 100;
      if (node.y < 50) fy += 100;
      if (node.y > this.canvasHeight - 50) fy -= 100;

      node.vx = (node.vx + fx) * damping;
      node.vy = (node.vy + fy) * damping;

      node.x += node.vx * K;
      node.y += node.vy * K;
    });

    return this.graphNodes;
  }

  drawNode(node) {
    const radius = 15;
    const color = this.getTypeColor(node.type);

    // Draw circle
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
    this.ctx.fill();

    // Draw border if selected
    if (this.selectedMemory?.id === node.id) {
      this.ctx.strokeStyle = '#58a6ff';
      this.ctx.lineWidth = 2;
      this.ctx.stroke();
    }

    // Draw icon
    this.ctx.fillStyle = '#fff';
    this.ctx.font = 'bold 10px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(this.getTypeEmoji(node.type), node.x, node.y);
  }

  getTypeColor(type) {
    const colors = {
      decision: '#8957e5',
      feature: '#b92f6a',
      bugfix: '#da3633',
      todo: '#1f6feb',
    };
    return colors[type] || '#58a6ff';
  }

  getTypeEmoji(type) {
    const emojis = {
      decision: '⚖️',
      feature: '🟣',
      bugfix: '🔴',
      todo: '📋',
    };
    return emojis[type] || '○';
  }

  handleCanvasClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const node = this.graphNodes?.find(n => {
      const dx = n.x - x;
      const dy = n.y - y;
      return Math.sqrt(dx * dx + dy * dy) < 20;
    });

    if (node) {
      this.selectMemory(node);
    }
  }

  handleCanvasHover(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const node = this.graphNodes?.find(n => {
      const dx = n.x - x;
      const dy = n.y - y;
      return Math.sqrt(dx * dx + dy * dy) < 20;
    });

    this.canvas.style.cursor = node ? 'pointer' : 'grab';
  }

  selectMemory(memory) {
    this.selectedMemory = memory;
    this.showDetailPanel(memory);
    this.drawGraph();
  }

  // Timeline View
  async renderTimeline() {
    this.showLoading(true);
    try {
      const timeline = await api.getTimeline({
        scope: this.filters.scope,
        limit: 100,
      });

      const container = document.getElementById('timeline-content');
      container.innerHTML = '';

      (timeline.data || []).forEach(item => {
        const el = document.createElement('div');
        el.className = 'timeline-item';
        el.innerHTML = `
          <div class="timeline-marker">${this.getTypeEmoji(item.type)}</div>
          <div class="timeline-content">
            <h4>${item.title}</h4>
            <p class="timeline-date">${new Date(item.createdAt).toLocaleString()}</p>
            <p>${item.description?.substring(0, 200)}...</p>
          </div>
        `;
        el.addEventListener('click', () => this.selectMemory(item));
        container.appendChild(el);
      });
    } catch (error) {
      console.error('Failed to load timeline:', error);
    } finally {
      this.showLoading(false);
    }
  }

  // Dependencies View
  async renderDependencies() {
    this.showLoading(true);
    try {
      const filesMap = await api.getAffectedFilesMap({
        scope: this.filters.scope,
      });

      const treeContainer = document.getElementById('file-tree-content');
      treeContainer.innerHTML = '';

      const files = filesMap.data?.files || [];
      files.forEach(file => {
        const el = document.createElement('div');
        el.className = 'tree-item';
        el.innerHTML = `
          ${file.path}
          <span class="tree-item-count">${file.memoryCount}</span>
        `;
        el.addEventListener('click', () => this.showFileDetails(file));
        treeContainer.appendChild(el);
      });
    } catch (error) {
      console.error('Failed to load dependencies:', error);
    } finally {
      this.showLoading(false);
    }
  }

  showFileDetails(file) {
    const container = document.getElementById('file-details-content');
    container.innerHTML = `
      <h5>${file.path}</h5>
      <p class="meta-label">Memories (${file.memories?.length || 0})</p>
      <div>
        ${(file.memories || []).map(m => `
          <div class="detail-item" onclick="app.selectMemory({...${JSON.stringify(m)}})">
            <span class="detail-item-type">${this.getTypeEmoji(m.type)}</span>
            <strong>${m.title}</strong>
          </div>
        `).join('')}
      </div>
    `;
  }

  // Search
  async performSearch() {
    const query = this.searchInput.value.trim();
    if (!query) return;

    this.showLoading(true);
    try {
      const results = await api.searchMemories(query, {
        scope: this.filters.scope,
        types: Array.from(this.filters.types),
        limit: 50,
      });

      this.switchView('search');
      this.renderSearchResults(results.data || []);
    } catch (error) {
      console.error('Search failed:', error);
      this.showError('Search failed');
    } finally {
      this.showLoading(false);
    }
  }

  renderSearchResults(results = []) {
    const container = document.getElementById('search-results-content');
    container.innerHTML = '';

    if (!results.length) {
      container.innerHTML = '<p class="meta-label">No results found</p>';
      return;
    }

    results.forEach(result => {
      const el = document.createElement('div');
      el.className = 'result-item';
      el.innerHTML = `
        <div class="result-header">
          <span class="result-type">${this.getTypeEmoji(result.type)}</span>
          <span class="result-title">${result.title}</span>
          <span class="result-score">${(result.score * 100).toFixed(0)}%</span>
        </div>
        <div class="result-meta">
          ${result.layer ? `Layer: <code>${result.layer}</code>` : ''}
          ${result.createdAt ? ` • ${new Date(result.createdAt).toLocaleDateString()}` : ''}
        </div>
        <div class="result-description">${result.description?.substring(0, 300) || ''}</div>
      `;
      el.addEventListener('click', () => this.selectMemory(result));
      container.appendChild(el);
    });
  }

  // Detail Panel
  showDetailPanel(memory) {
    document.getElementById('detail-title').textContent = memory.title;
    document.getElementById('detail-body').innerHTML = `<p>${memory.description || 'No description'}</p>`;

    const metaEl = document.getElementById('detail-meta');
    metaEl.innerHTML = `
      <div class="meta-label">Metadata</div>
      ${memory.type ? `<div class="meta-value"><strong>Type:</strong> ${memory.type}</div>` : ''}
      ${memory.layer ? `<div class="meta-value"><strong>Layer:</strong> ${memory.layer}</div>` : ''}
      ${memory.createdAt ? `<div class="meta-value"><strong>Created:</strong> ${new Date(memory.createdAt).toLocaleString()}</div>` : ''}
      ${memory.platform ? `<div class="meta-value"><strong>Platform:</strong> ${memory.platform}</div>` : ''}
    `;

    const relEl = document.getElementById('detail-relations');
    if (memory.affectedFiles?.length) {
      relEl.innerHTML = `
        <div class="meta-label">Affected Files</div>
        ${memory.affectedFiles.map(f => `<span class="relation-badge">${f}</span>`).join('')}
      `;
    }

    this.detailPanel.classList.remove('hidden');
  }

  closeDetailPanel() {
    this.detailPanel.classList.add('hidden');
    this.selectedMemory = null;
    this.drawGraph();
  }

  // Utilities
  getFilteredMemories() {
    return this.memories.filter(m => {
      const typeMatch = this.filters.types.has(m.type);
      const layerMatch = !this.filters.layer || m.layer === this.filters.layer;
      return typeMatch && layerMatch;
    });
  }

  resizeCanvas() {
    const container = this.canvas.parentElement;
    this.canvas.width = container.clientWidth;
    this.canvas.height = container.clientHeight;
  }

  showLoading(show) {
    this.loadingIndicator.classList.toggle('hidden', !show);
  }

  showError(message) {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #da3633;
      color: white;
      padding: 16px 24px;
      border-radius: 8px;
      z-index: 1000;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 5000);
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new CodeMemApp();
});
