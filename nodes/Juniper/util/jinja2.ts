import _ from 'lodash';
import { JuniperDiff, JuniperNode } from './juniper';

function findLoopOpportunities(diff: JuniperDiff[]) {
  return diff.reduce((acc, { path }) => {
    const wildcardPath = path.slice(0, -2).join('.');
    const existingKey = Object.keys(acc).find((candidate) => wildcardPath === candidate || wildcardPath.startsWith(candidate + '.'));
    const key = existingKey ?? wildcardPath;
    const existingList = acc[key] ?? [];
    const subgroup = +path.join('.').substr(key.length + 1).split('.')[0];
    return { ...acc, [key]: [...existingList, {path: path.join('.'), subgroup}] }
  }, {} as Record<string, Array<{ path: string, subgroup: number }>>);
}

function convertToLoopBody(ast: JuniperNode, variables: Record<string, object>): JuniperNode {
  const replaced = { ...ast };

  // Check and replace `name` and `value` if found in variables
  if (replaced.name) {
    replaced.name = replaced.name.split('.').map(name => variables[name] ? `{{${variables[name]}}}` : name).join('.');
  }

  if (replaced.value) {
    replaced.value = replaced.value.split('.').map(value => variables[value] ? `{{${variables[value]}}}` : value).join('.');
  }

  // Recurse into children
  if (Array.isArray(replaced.children)) {
    replaced.children = replaced.children.map(child => convertToLoopBody(child, variables));
  }

  return replaced;
}

function flattenObjectReverse(obj: object, prefix = '', res: any = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flattenObjectReverse(value, path, res);
    } else {
      res[value] = path;
    }
  }
  return res;
}

export function convertToJinja2Ast(ast: JuniperNode, diff: JuniperDiff[], variables: Record<string, object>) {
  return Object.entries(findLoopOpportunities(diff)).reduce((acc, [loopPath, changes]) => {
    const subgroups = [...new Set(changes.map(({ subgroup }) => subgroup))];
    const original = _.get(acc, loopPath) as JuniperNode[];
    const loopBody = convertToLoopBody(original[subgroups[0]], flattenObjectReverse(variables));
    _.set(acc, loopPath, [
      {
        type: 'flag',
        name: `{% for interface in interface.physical %}`,
        value: null,
        children: []
      },
      loopBody,
      {
        type: 'flag',
        name: `{% endfor %}`,
        value: null,
        children: []
      },
      ...original.filter((_child, index) => !subgroups.includes(index))
    ]);
    return acc;
  }, _.cloneDeep(ast));
}
