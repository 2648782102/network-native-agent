export const ANNOTATION_LABELS = ['echo', 'trace', 'migrate', 'sleep'];

const cueFamilies = {
  echo: ['repeat', 'repeats', 'same', 'duplicate', 'mirror', 'echo', 'echoes'],
  trace: ['trace', 'remember', 'record', 'memory', 'historical', 'ambiguous'],
  migrate: ['migrate', 'relocate', 'mobility', 'unstable', 'another relay', 'new body', 'urgent', 'fast change', 'closing'],
  sleep: ['calm', 'quiet', 'rest', 'inactive', 'no action', 'conserve', 'credits are low', 'stable body'],
};

export function cohensKappa(pairs) {
  if (!pairs.length) return { kappa: null, observedAgreement: null, expectedAgreement: null, n: 0 };
  const labels = new Set();
  for (const [left, right] of pairs) {
    labels.add(left);
    labels.add(right);
  }
  const observed = pairs.filter(([left, right]) => left === right).length / pairs.length;
  let expected = 0;
  for (const label of labels) {
    const leftRate = pairs.filter(([left]) => left === label).length / pairs.length;
    const rightRate = pairs.filter(([, right]) => right === label).length / pairs.length;
    expected += leftRate * rightRate;
  }
  const kappa = expected === 1 ? null : (observed - expected) / (1 - expected);
  return {
    kappa: kappa === null ? null : Number(kappa.toFixed(4)),
    observedAgreement: Number(observed.toFixed(4)),
    expectedAgreement: Number(expected.toFixed(4)),
    n: pairs.length,
  };
}

export function buildBlindSheet(tasks) {
  return {
    version: 1,
    instructions: 'Label each task with exactly one of echo, trace, migrate, sleep using ANNOTATION_PROTOCOL.md. Do not inspect prior labels.',
    options: [...ANNOTATION_LABELS],
    items: tasks.map((task) => ({
      taskId: task.id,
      source: task.source,
      text: task.text,
    })),
  };
}

export function auditLabelRisk(tasks) {
  const items = tasks.map((task) => {
    const text = String(task.text ?? '').toLowerCase();
    const families = Object.entries(cueFamilies)
      .filter(([, cues]) => cues.some((cue) => text.includes(cue)))
      .map(([label]) => label);
    const assigned = task.intent ?? null;
    return {
      taskId: task.id,
      assigned,
      cueFamilies: families,
      contested: families.length !== 1,
      assignedSupported: assigned ? families.includes(assigned) : false,
    };
  });
  return {
    total: items.length,
    contested: items.filter((item) => item.contested).length,
    unsupported: items.filter((item) => !item.assignedSupported).length,
    items,
  };
}

export function buildAgreementReport(annotations, tasks) {
  const byTask = new Map();
  for (const annotation of annotations) {
    if (!byTask.has(annotation.taskId)) byTask.set(annotation.taskId, new Map());
    byTask.get(annotation.taskId).set(annotation.annotator, annotation.label);
  }
  const annotators = [...new Set(annotations.map((annotation) => annotation.annotator))].sort();
  const pairs = [];
  const pairNames = [];
  for (let left = 0; left < annotators.length; left += 1) {
    for (let right = left + 1; right < annotators.length; right += 1) {
      pairNames.push([annotators[left], annotators[right]]);
    }
  }
  const pairwise = pairNames.map(([left, right]) => {
    const comparison = [];
    for (const [taskId, labels] of byTask) {
      if (labels.has(left) && labels.has(right)) comparison.push([labels.get(left), labels.get(right)]);
    }
    return { left, right, ...cohensKappa(comparison), taskIds: comparison.length };
  });
  const validity = tasks.map((task) => {
    const labels = byTask.get(task.id) ?? new Map();
    const values = annotators.filter((annotator) => labels.has(annotator)).map((annotator) => labels.get(annotator));
    const unanimous = values.length > 0 && values.every((value) => value === values[0]);
    return { taskId: task.id, labels: Object.fromEntries(labels), unanimous, usable: unanimous && values.length >= 2 };
  });
  return {
    annotators,
    annotatedTasks: byTask.size,
    pairwise,
    unusableTasks: validity.filter((item) => !item.usable).map((item) => item.taskId),
    tasks: validity,
  };
}
