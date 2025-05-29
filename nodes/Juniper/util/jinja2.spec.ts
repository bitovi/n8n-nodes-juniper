import fs from 'fs';
import path from 'path';
import { convertToJinja2Ast } from './jinja2';
import {
	addInterfaceProp,
	astToConfig,
	diffAst,
	Interface,
	JuniperDiff,
	JuniperNode,
	parseJuniperConfig,
} from './juniper';

describe('jinja2', () => {
	let ast1: JuniperNode;
	let ast2: JuniperNode;
	let diff1: JuniperDiff[];
	let diff2: JuniperDiff[];
	let interfaces1: Interface[];
	let interfaces2: Interface[];

	beforeAll(async () => {
		const [config1, config2] = await Promise.all(
			['smelt-scale-2.conf', 'smelt-scale-1.conf'].map((filename) =>
				fs.promises.readFile(
					path.resolve(__dirname, `../ansible/Ansible-Updated/${filename}`),
					'utf8',
				),
			),
		);

		ast1 = parseJuniperConfig(config1);
		ast2 = parseJuniperConfig(config2);

		diff1 = diffAst(ast1, ast2);
		diff2 = diffAst(ast2, ast1);

		[interfaces1, interfaces2] = [diff1, diff2].map((diff) =>
			diff.reduce((acc, { absolutePath, type, oldValue }) => {
				if (type !== 'replace') return acc;
				return addInterfaceProp(acc, absolutePath, oldValue);
			}, [] as Interface[]),
		);
	});

	describe('convertToLoopBody', () => {
		it('does not replace unit', () => {
			const jinja2Ast1 = convertToJinja2Ast(ast1, diff1, { interface: interfaces1[0] });
			const jinja2String1 = astToConfig(jinja2Ast1).replace(/%};/g, '%}');

			expect(jinja2String1).toContain('interface {{interface.name}}.100;');

			const jinja2Ast2 = convertToJinja2Ast(ast2, diff2, { interface: interfaces2[0] });
			const jinja2String2 = astToConfig(jinja2Ast2).replace(/%};/g, '%}');

			expect(jinja2String2).toContain('interface {{interface.name}}.100;');
		});
	});
});
