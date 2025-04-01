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

  if (replaced.name === 'interface' && replaced.value) {
    replaced.value = replaced.value.split('.').map((value, index) => {
      if (index === 0 && variables[value].toString() === 'interface.name') return `{{${variables[value]}}}`;
      if (index === 1 && variables[value].toString() === 'interface.unit.name') return `{{${variables[value]}}}`;
      return value;
    }).join('.');
  } else {
    // Check and replace `name` and `value` if found in variables
		if (replaced.name) {
    	replaced.name = variables[replaced.name] ? `{{${variables[replaced.name]}}}` : replaced.name;
		}

		if (replaced.value) {
    	replaced.value = variables[replaced.value] ? `{{${variables[replaced.value]}}}` : replaced.value;
		}
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
    const original = _.get(acc, loopPath);
    _.set(acc, loopPath, original.reduce((acc2: JuniperNode[], child: JuniperNode, index: number) => {
      if (index === subgroups[0]) {
        return [
          ...acc2,
          ...[
            {
              type: 'flag',
              name: `{% for interface in interface.physical %}`,
              value: null,
              children: []
            },
            convertToLoopBody(original[subgroups[0]], flattenObjectReverse(variables)),
            {
              type: 'flag',
              name: `{% endfor %}`,
              value: null,
              children: []
            }
          ]
        ];
      }

      if (!subgroups.includes(index)) {
        return [...acc2, child];
      }

      return acc2;

    }, []));
    return acc;
  }, _.cloneDeep(ast));
}
