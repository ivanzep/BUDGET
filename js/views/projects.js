import { api } from '../api.js';
import { escapeHtml, toast } from '../util.js';

export async function renderProjects(container) {
  container.innerHTML = `
    <div class="view-header">
      <h2>Projects</h2>
      <a class="btn btn-primary" href="#/edit/new">+ New Project</a>
    </div>
    <div id="projects-list">Loading...</div>
  `;

  try {
    const projects = await api.listProjects();
    const listEl = container.querySelector('#projects-list');
    if (!projects.length) {
      listEl.innerHTML = '<p class="muted">No saved projects yet. Create one to get started.</p>';
      return;
    }
    listEl.innerHTML = `
      <table class="table">
        <thead><tr><th>Name</th><th>Last Updated</th><th></th></tr></thead>
        <tbody>
          ${projects
            .map(
              (p) => `
            <tr>
              <td>${escapeHtml(p.name)}</td>
              <td>${p.updated ? new Date(p.updated).toLocaleString() : ''}</td>
              <td class="row-actions">
                <a href="#/edit/${p.id}">Edit</a>
                <a href="#/summary/${p.id}">Summary</a>
                <a href="#" data-delete="${p.id}" class="danger">Delete</a>
              </td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    `;
    listEl.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (!confirm('Delete this project? This moves the Google Sheet to trash.')) return;
        try {
          await api.deleteProject(btn.dataset.delete);
          toast('Project deleted');
          renderProjects(container);
        } catch (err) {
          toast(err.message, true);
        }
      });
    });
  } catch (err) {
    container.querySelector('#projects-list').innerHTML = `<p class="error">Could not load projects: ${escapeHtml(err.message)}</p>`;
  }
}
