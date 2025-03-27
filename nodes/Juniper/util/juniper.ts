import _ from 'lodash';

/**
 * Generic Juniper Configuration Parser
 *
 * This module parses Juniper configuration files into an Abstract Syntax Tree (AST)
 * without relying on specific keywords, making it compatible with any Juniper configuration.
 */

export interface JuniperNode {
	type: string;
	name: string | null;
	value: string | null;
	children: JuniperNode[];
}

/**
 * Create a new AST node
 * @param {string} type - The type of node
 * @param {string|null} name - The name or identifier of the node
 * @param {string|null} value - The value associated with the node
 * @param {Array} children - Child nodes
 * @return {Object} - A new AST node
 */
const createNode = (type: string, name: string | null = null, value: string | null = null, children: JuniperNode[] = []): JuniperNode => ({
  type,
  name,
  value,
  children: [...children]
});

/**
 * Parse a Juniper configuration string into an AST
 * @param {string} config - The configuration string to parse
 * @return {Object} - The AST representation of the config
 */
export function parseJuniperConfig(config: string): JuniperNode {
  // Preprocess the config
  // - Remove empty lines
  // - Remove comments
  // - Trim whitespace
  const lines = config
    .split('\n')
    .map(line => line.replace(/#.*$/, '').trim()) // Remove comments
    .filter(line => line.length > 0);

  // Root node of our AST
  const ast = createNode('root');

  // Parse the lines
  parseBlock(lines, 0, ast);

  return ast;
}

/**
 * Parse a block of configuration and add it to the parent node
 * @param {string[]} lines - All lines of the configuration
 * @param {number} startIndex - The starting line index for this block
 * @param {Object} parent - The parent node to add parsed nodes to
 * @return {number} - The index after this block ends
 */
function parseBlock(lines: string[], startIndex: number, parent: any): number {
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i];

    // Handle the end of a block
    if (line === '}') {
      return i + 1;
    }

    // Generic rule for blocks with wildcards/patterns
    // Matches patterns like "something <pattern> {"
    const patternBlockMatch = line.match(/^(\S+)\s+(<[^>]+>)\s+{$/);
    if (patternBlockMatch) {
      const blockType = patternBlockMatch[1];
      const pattern = patternBlockMatch[2];
      const blockNode = createNode('pattern-block', blockType, pattern);
      parent.children.push(blockNode);
      i = parseBlock(lines, i + 1, blockNode);
      continue;
    }

    // Generic rule for multi-word block headers ending with "{"
    // This captures blocks like "system location {" or "unit 100 {"
    const multiWordBlockMatch = line.match(/^(.+)\s+{$/);
    if (multiWordBlockMatch) {
      let blockHeader = multiWordBlockMatch[1].trim();
      const parts = blockHeader.split(/\s+/);

      if (parts.length === 1) {
        // Simple block like "interfaces {"
        const blockNode = createNode('block', parts[0]);
        parent.children.push(blockNode);
        i = parseBlock(lines, i + 1, blockNode);
      } else {
        // Complex block like "unit 100 {" or "family inet {"
        const blockType = parts[0];
        const blockValue = parts.slice(1).join(' ');
        const blockNode = createNode('named-block', blockType, blockValue);
        parent.children.push(blockNode);
        i = parseBlock(lines, i + 1, blockNode);
      }
      continue;
    }

    // Handle leaf nodes (ending with semicolon)
    const leafMatch = line.match(/^(.+);$/);
    if (leafMatch) {
      const statement = leafMatch[1].trim();

      // Check if it's a directive like "apply-groups something;"
      if (statement.includes(' ')) {
        const parts = statement.split(/\s+/);
        const directive = parts[0];
        const value = parts.slice(1).join(' ').replace(/"/g, '');
        parent.children.push(createNode('directive', directive, value));
      } else {
        // It's a flag/property without a value like "primary;"
        parent.children.push(createNode('flag', statement));
      }

      i++;
      continue;
    }

    // If we can't parse the line, just skip it
    console.warn(`Warning: Could not parse line ${i + 1}: "${line}"`);
    i++;
  }

  return i;
}

/**
 * Convert AST back to Juniper configuration string
 * @param {Object} ast - The AST to convert
 * @return {string} - The Juniper configuration string
 */
export function astToConfig(ast: JuniperNode): string {
  return nodeToConfig(ast, 0);
}

/**
 * Helper for astToConfig that converts a node to config string
 */
function nodeToConfig(node: JuniperNode, indent: number): string {
  const indentStr = '    '.repeat(indent);
  let result = '';

  if (node.type === 'root') {
    // Root node has no representation in the config
    return node.children.map(child => nodeToConfig(child, indent)).join('\n');
  }

  if (node.type === 'block') {
    result += `${indentStr}${node.name} {\n`;
    const childrenConfig = node.children.map(child => nodeToConfig(child, indent + 1)).join('\n');
    result += childrenConfig ? childrenConfig + '\n' : '';
    result += `${indentStr}}`;
    return result;
  }

  if (node.type === 'named-block' || node.type === 'pattern-block') {
    result += `${indentStr}${node.name} ${node.value} {\n`;
    const childrenConfig = node.children.map(child => nodeToConfig(child, indent + 1)).join('\n');
    result += childrenConfig ? childrenConfig + '\n' : '';
    result += `${indentStr}}`;
    return result;
  }

  if (node.type === 'directive') {
    return `${indentStr}${node.name} ${node.value};`;
  }

  if (node.type === 'flag') {
    return `${indentStr}${node.name};`;
  }

  // Default case
  return `${indentStr}# Unknown node type: ${node.type}`;
}

export interface DiffOptions {
	ignoreProperties?: string[];
	ignoreArrayOrder?: boolean;
	maxDepth?: number;
	currentPath?: string[];
	absolutePath?: string[]; // New parameter to track absolute path through the AST
}

export interface JuniperDiff {
	type: string,
	path: string[],
	absolutePath: string[],
	oldValue?: object;
	newValue?: object;
	property?: any;
	nodeType?: string;
	oldType?: string;
	newType?: string;
}

/**
 * Compares two AST nodes or arrays of AST nodes and returns a detailed difference report with absolute paths
 * @param {Object|Array} oldAst - The original AST node or array
 * @param {Object|Array} newAst - The new AST node or array
 * @param {Object} options - Configuration options
 * @returns {Array} - Array of difference objects with absolute paths
 */
export function diffAst(oldAst: JuniperNode, newAst: JuniperNode, options: DiffOptions = {}): JuniperDiff[] {
  const diffs: JuniperDiff[] = [];
  const {
    ignoreProperties = ['loc', 'range'],
    ignoreArrayOrder = false,
    maxDepth = Infinity,
    currentPath = [],
    absolutePath = [], // New parameter to track absolute path through the AST
  } = options;

  // Helper function to check if a property should be ignored
  const shouldIgnore = (prop: string) => ignoreProperties.includes(prop);

  // Helper to get node type
  const getNodeType = (node: JuniperNode) => node && typeof node === 'object' ? (node.type || 'Unknown') : typeof node;

  // Helper to calculate absolute path based on node traversal
  const getAbsolutePath = (node: JuniperNode, pathSegment: string) => {
    // Don't add the node's name if it's already the last component of the absolutePath
    const lastComponent = absolutePath.length > 0 ? absolutePath[absolutePath.length - 1] : null;

    if (!node || typeof node !== 'object') return [...absolutePath, pathSegment];

    // For named nodes, include ONLY their name in the path (not the value)
    if (node.name) {
      // Modified: Use only node.name instead of concatenating with node.value
      const nodePathComponent = node.name;

      // Check if this component is already the last element in the path
      if (lastComponent === nodePathComponent) {
        return [...absolutePath]; // Don't duplicate
      }
      return [...absolutePath, nodePathComponent];
    }

    return [...absolutePath, pathSegment];
  };

  // Rest of the diffAst function remains unchanged...

  // Handle case where nodes are completely different types
  if (typeof oldAst !== typeof newAst) {
    return [{
      type: 'replace',
      path: [...currentPath],
      absolutePath: [...absolutePath],
      oldValue: oldAst,
      newValue: newAst,
      oldType: typeof oldAst,
      newType: typeof newAst
    }];
  }

  // Handle primitives (including null)
  if (oldAst === null || newAst === null || typeof oldAst !== 'object' || typeof newAst !== 'object') {
    if (oldAst !== newAst) {
      return [{
        type: 'replace',
        path: [...currentPath],
        absolutePath: [...absolutePath],
        oldValue: oldAst,
        newValue: newAst
      }];
    }
    return [];
  }

  // Handle arrays
  if (Array.isArray(oldAst) && Array.isArray(newAst)) {
    if (ignoreArrayOrder) {
      // When array order doesn't matter, try to match nodes by similarity
      const matchedIndexes = new Set();

      // First pass: match nodes by similarity
      for (let i = 0; i < oldAst.length; i++) {
        const oldNode = oldAst[i];
        let bestMatchIndex = -1;
        let bestMatchScore = -1;

        for (let j = 0; j < newAst.length; j++) {
          if (matchedIndexes.has(j)) continue;

          const similarityScore = calculateSimilarity(oldNode, newAst[j]);
          if (similarityScore > bestMatchScore) {
            bestMatchScore = similarityScore;
            bestMatchIndex = j;
          }
        }

        if (bestMatchIndex >= 0 && bestMatchScore > 0.7) { // 70% similarity threshold
          matchedIndexes.add(bestMatchIndex);
          // Recursively compare matched nodes for detailed differences
          const nodePath = getAbsolutePath(oldNode, i.toString());

          const childDiffs = diffAst(
            oldNode,
            newAst[bestMatchIndex],
            {
              ...options,
              currentPath: [...currentPath, i.toString()],
              absolutePath: nodePath,
              maxDepth: maxDepth > 0 ? maxDepth - 1 : 0
            }
          );
          diffs.push(...childDiffs);
        } else {
          // No good match found, old node was removed
          diffs.push({
            type: 'remove',
            path: [...currentPath, i.toString()],
            absolutePath: getAbsolutePath(oldNode, i.toString()),
            oldValue: oldNode,
            nodeType: getNodeType(oldNode)
          });
        }
      }

      // Find unmatched new nodes (additions)
      for (let j = 0; j < newAst.length; j++) {
        if (!matchedIndexes.has(j)) {
          diffs.push({
            type: 'add',
            path: [...currentPath, j.toString()],
            absolutePath: getAbsolutePath(newAst[j], j.toString()),
            newValue: newAst[j],
            nodeType: getNodeType(newAst[j])
          });
        }
      }
    } else {
      // When array order matters, compare by index
      const maxLength = Math.max(oldAst.length, newAst.length);

      for (let i = 0; i < maxLength; i++) {
        if (i >= oldAst.length) {
          // New items added at the end
          diffs.push({
            type: 'add',
            path: [...currentPath, i.toString()],
            absolutePath: getAbsolutePath(newAst[i], i.toString()),
            newValue: newAst[i],
            nodeType: getNodeType(newAst[i])
          });
        } else if (i >= newAst.length) {
          // Old items removed from the end
          diffs.push({
            type: 'remove',
            path: [...currentPath, i.toString()],
            absolutePath: getAbsolutePath(oldAst[i], i.toString()),
            oldValue: oldAst[i],
            nodeType: getNodeType(oldAst[i])
          });
        } else if (maxDepth !== 0) {
          // Both items exist, compare them recursively
          const nodePath = getAbsolutePath(oldAst[i], i.toString());

          const childDiffs = diffAst(
            oldAst[i],
            newAst[i],
            {
              ...options,
              currentPath: [...currentPath, i.toString()],
              absolutePath: nodePath,
              maxDepth: maxDepth > 0 ? maxDepth - 1 : 0
            }
          );
          diffs.push(...childDiffs);
        }
      }
    }

    return diffs;
  }

  // Handle objects (including AST nodes)
  const allProps = new Set([
    ...Object.keys(oldAst),
    ...Object.keys(newAst)
  ]);

  for (const prop of allProps) {
    if (shouldIgnore(prop)) continue;

    if (!(prop in oldAst)) {
      // Property added
      diffs.push({
        type: 'add-prop',
        path: [...currentPath, prop],
        absolutePath: [...absolutePath, prop],
				// @ts-ignore
        newValue: newAst[prop],
        property: prop
      });
    } else if (!(prop in newAst)) {
      // Property removed
      diffs.push({
        type: 'remove-prop',
        path: [...currentPath, prop],
        absolutePath: [...absolutePath, prop],
				// @ts-ignore
        oldValue: oldAst[prop],
        property: prop
      });
    } else if (maxDepth !== 0) {
      // Property exists in both, compare recursively
      let nodePath = [...absolutePath];

      // For named nodes, include their name in the path
      if (prop === 'children' && oldAst.name) {
        // Create node path component
        const nodePathComponent = oldAst.name + (oldAst.value ? ' ' + oldAst.value : '');
        // Check if this component is already the last element in the path
        const lastComponent = absolutePath.length > 0 ? absolutePath[absolutePath.length - 1] : null;

        if (lastComponent === nodePathComponent) {
          nodePath = [...absolutePath]; // Don't duplicate
        } else {
          nodePath = [...absolutePath, nodePathComponent];
        }
      } else if (prop !== 'children') {
        nodePath = [...absolutePath, prop];
      }

      const childDiffs = diffAst(
				// @ts-ignore
        oldAst[prop],
				// @ts-ignore
        newAst[prop],
        {
          ...options,
          currentPath: [...currentPath, prop],
          absolutePath: nodePath,
          maxDepth: maxDepth > 0 ? maxDepth - 1 : 0
        }
      );
      diffs.push(...childDiffs);
    }
  }

  return diffs;
}

/**
 * Calculate similarity score between two AST nodes
 * @param {Object} nodeA - First AST node
 * @param {Object} nodeB - Second AST node
 * @returns {number} - Similarity score between 0 and 1
 */
function calculateSimilarity(nodeA: JuniperNode, nodeB: JuniperNode): number {
  // Return 0 for completely different types
  if (typeof nodeA !== typeof nodeB) return 0;
  if (nodeA === null || nodeB === null) return nodeA === nodeB ? 1 : 0;
  if (typeof nodeA !== 'object' || typeof nodeB !== 'object') return nodeA === nodeB ? 1 : 0;

  // Different node types already indicate difference
  if (nodeA.type !== nodeB.type) return 0.1; // Small baseline similarity for nodes of different types

  // For arrays, calculate average similarity of elements
  if (Array.isArray(nodeA) && Array.isArray(nodeB)) {
    if (nodeA.length === 0 && nodeB.length === 0) return 1;
    if (nodeA.length === 0 || nodeB.length === 0) return 0.3; // Some similarity for empty vs non-empty arrays

    // If arrays are of vastly different sizes, they're probably not that similar
    const lengthRatio = Math.min(nodeA.length, nodeB.length) / Math.max(nodeA.length, nodeB.length);
    if (lengthRatio < 0.5) return 0.2 + (lengthRatio * 0.3); // Base similarity plus adjustment for length ratio

    // Compare a subset of elements to avoid excessive computation
    const maxComparisons = 5;
    const comparisons = Math.min(maxComparisons, nodeA.length, nodeB.length);

    let totalSimilarity = 0;
    for (let i = 0; i < comparisons; i++) {
      const indexA = Math.floor((i / comparisons) * nodeA.length);
      const indexB = Math.floor((i / comparisons) * nodeB.length);
      totalSimilarity += calculateSimilarity(nodeA[indexA], nodeB[indexB]);
    }

    return (0.5 + (0.5 * (totalSimilarity / comparisons))) * lengthRatio;
  }

  // For objects/nodes, compare properties
  const propsA = Object.keys(nodeA).filter(p => p !== 'loc' && p !== 'range');
  const propsB = Object.keys(nodeB).filter(p => p !== 'loc' && p !== 'range');

  if (propsA.length === 0 && propsB.length === 0) return 1;
  if (propsA.length === 0 || propsB.length === 0) return 0.3;

  // Calculate property overlap
  const commonProps = propsA.filter(p => propsB.includes(p));
  const propOverlap = commonProps.length / Math.max(propsA.length, propsB.length);

  // Check values of common properties
  let valueSimilarity = 0;
  if (commonProps.length > 0) {
    // Select a subset of important properties to check
    const keyProps = commonProps.filter(p =>
      ['id', 'name', 'value', 'operator', 'key', 'kind', 'computed'].includes(p)
    );

    const propsToCheck = keyProps.length > 0 ? keyProps : commonProps.slice(0, 3);
    let checkedProps = 0;

    for (const prop of propsToCheck) {
      checkedProps++;
			// @ts-ignore
      if (typeof nodeA[prop] !== 'object' && typeof nodeB[prop] !== 'object') {
				// @ts-ignore
        valueSimilarity += nodeA[prop] === nodeB[prop] ? 1 : 0;
				// @ts-ignore
      } else if (nodeA[prop] && nodeB[prop]) {
        // For object properties, do a shallow similarity check
        valueSimilarity += 0.5; // Partial credit for having the same structure
      }
    }

    valueSimilarity = checkedProps > 0 ? valueSimilarity / checkedProps : 0;
  }

  // Weight: 50% property overlap, 50% value similarity (for important props)
  return 0.5 * propOverlap + 0.5 * valueSimilarity;
}

export interface Interface {
	name: string;
	[key: string]: any;
}

export function addInterfaceProp(interfaces: Array<Interface>, path: string[], value?: object): Array<Interface> {
  if (path[0] !== 'interfaces') return interfaces;

  const interfaceName = path[1];
  const normalizedPath = path.filter((_, index) => index && index % 2 === 0).join('.');
  let match = interfaces.find(i => i.name === interfaceName);

  if (!match) {
    interfaces.push({ name: interfaceName });
    match = interfaces[interfaces.length - 1];
  }

  if (normalizedPath !== 'name') {
    _.set(match, normalizedPath, value);
  }

  return interfaces;
}
