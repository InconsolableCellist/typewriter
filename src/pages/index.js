// Finished pages: when a sheet is retired its image is archived, it lands on the desk, and the pile opens a viewer.
import { PageArchive, createWorkerEncoder } from './archive.js';
import { DeskPile } from './desk-pile.js';
import { PageViewer } from './viewer.js';
import { FreshStack } from './fresh-stack.js';

export function installPages({ stage, soft, paper, machine, interaction, hands }) {
  const archive = new PageArchive({ encode: createWorkerEncoder() });
  const pile = new DeskPile({
    scene: stage.scene, renderer: stage.renderer, camera: stage.camera, paperMaterial: paper.material, machine,
    maxAniso: stage.renderer.capabilities.getMaxAnisotropy(),
  });
  const viewer = new PageViewer({ archive });
  archive.onPage = (page) => { pile.add(page); viewer.refresh(); };
  soft.onSheetRetired = (snapshot) => { archive.retire(snapshot); };
  interaction.picker.add({
    object: pile.proxy,
    enabled: () => archive.pages.length > 0,
    part: () => ({ kind: 'pages', label: `Finished pages (${archive.pages.length})`, cursor: 'pointer', visual: () => pile.top ?? pile.proxy, onClick: () => viewer.open() }),
  });
  const fresh = new FreshStack({ scene: stage.scene, paperMaterial: paper.material, machine });
  interaction.picker.add({
    object: fresh.proxy,
    part: () => ({ kind: 'freshPaper', label: 'Fresh paper: click to load a sheet', cursor: 'pointer', visual: () => fresh.highlight, onClick: () => hands.loadPaper() }),
  });
  return { archive, pile, viewer, fresh, update: (dt) => { pile.update(dt); fresh.update(); } };
}
