/**
 * reporting.js — Structured Site Reports
 * Builds a report object purely from AppState (no invented data) and
 * offers JSON/CSV export for handoff to the yard office or a backend later.
 */
import { AppState } from './state.js';

export function buildReport() {
  const snap = AppState.getSnapshot();
  const durationMs = snap.startedAt ? Date.now() - snap.startedAt : 0;

  return {
    generatedAt: new Date().toISOString(),
    sessionId: snap.sessionId,
    siteId: snap.siteId,
    driverId: snap.driverId,
    startedAt: snap.startedAt ? new Date(snap.startedAt).toISOString() : null,
    durationMinutes: Math.round(durationMs / 60000 * 10) / 10,
    modelUsed: snap.modelName,
    totals: {
      total: snap.counts.total,
      byClass: snap.counts.byClass
    },
    events: snap.events.map(e => ({
      trackId: e.trackId,
      class: e.classLabel,
      confidence: Number(e.confidence?.toFixed?.(3) ?? e.confidence),
      timestamp: new Date(e.timestamp).toISOString()
    })),
    yardEstimate: snap.yardEstimate
      ? {
          ...snap.yardEstimate,
          note: 'Yard estimate — visual pile count, not a confirmed conveyor count.'
        }
      : null
  };
}

export function reportToCSV(report) {
  const header = 'trackId,class,confidence,timestamp';
  const rows = report.events.map(e => `${e.trackId},${e.class},${e.confidence},${e.timestamp}`);
  const summary = [
    '',
    `# Session,${report.sessionId}`,
    `# Site,${report.siteId ?? ''}`,
    `# Driver,${report.driverId ?? ''}`,
    `# Total,${report.totals.total}`,
    ...Object.entries(report.totals.byClass).map(([k, v]) => `# ${k},${v}`)
  ];
  return [header, ...rows, ...summary].join('\n');
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportReportJSON() {
  const report = buildReport();
  downloadBlob(JSON.stringify(report, null, 2), `tirecycle_report_${report.sessionId}.json`, 'application/json');
  return report;
}

export function exportReportCSV() {
  const report = buildReport();
  downloadBlob(reportToCSV(report), `tirecycle_report_${report.sessionId}.csv`, 'text/csv');
  return report;
}
