import {
	IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription
} from 'n8n-workflow';
import { addInterfaceProp, astToConfig, diffAst, Interface, JuniperDiff, JuniperNode, parseJuniperConfig } from './util/juniper';
import { convertToJinja2Ast } from './util/jinja2';

export class Juniper implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Juniper',
		name: 'juniper',
		// eslint-disable-next-line n8n-nodes-base/node-class-description-icon-not-svg
		icon: 'file:juniper.png',
		group: ['transform'],
		version: 1,
		description: 'Work With Juniper Files',
		defaults: {
			name: 'Juniper',
		},
		inputs: ['main'],
		outputs: ['main'],
		properties: [
			{
				displayName: 'Action',
				name: 'action',
				type: 'options',
				options: [
					{
						name: 'Parse Juniper Config',
						value: 'parse',
					},
					{
						name: 'Compare Juniper Configs',
						value: 'diff',
					},
					{
						name: 'Extract Juniper Variables',
						value: 'extractVariables',
					},
					{
						name: 'Generate Jinja2 File',
						value: 'generateJinja2',
					},
				],
				default: 'parse',
			},
      {
        displayName: 'Input Binary Field',
        name: 'inputBinaryField',
        type: 'string',
        default: 'data',
        required: true,
        description: 'Name of the binary property containing the file to process',
				displayOptions: {
					show: {
						action: ['parse'],
					},
				},
      },
			{
        displayName: 'Juniper Configuration AST',
        name: 'ast',
        type: 'json',
        default: '{}',
        required: true,
				displayOptions: {
					show: {
						action: ['diff', 'generateJinja2'],
					},
				},
      },
			{
        displayName: 'Juniper Diff',
        name: 'diff',
        type: 'json',
        default: '{}',
        required: true,
				displayOptions: {
					show: {
						action: ['extractVariables', 'generateJinja2'],
					},
				},
      },
			{
        displayName: 'Interface',
        name: 'interface',
        type: 'json',
        default: '{}',
        required: true,
				displayOptions: {
					show: {
						action: ['generateJinja2'],
					},
				},
      }
    ],
	};
	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
      try {
				const action = this.getNodeParameter('action', i) as string;

				switch (action) {
					case 'parse': {
						const inputBinaryField = this.getNodeParameter('inputBinaryField', i) as string;
						const binaryData = this.helpers.assertBinaryData(i, inputBinaryField);
						const stringData = Buffer.from(binaryData.data, 'base64').toString('utf8');

						returnData.push({ json: { ast: parseJuniperConfig(stringData) } });

						break;
					}
					case 'diff': {
						if (i < items.length / 2) {
							const ast1 = this.getNodeParameter('ast', i * 2) as JuniperNode;
							const ast2 = this.getNodeParameter('ast', (i * 2) + 1) as JuniperNode;

							returnData.push(
								{ json: { diff: diffAst(ast1, ast2) } },
								{ json: { diff: diffAst(ast2, ast1) } }
							);
						}

						break;
					}
					case 'extractVariables': {
						const diff = this.getNodeParameter('diff', i) as JuniperDiff[];
						const interfaces = diff.reduce((acc, { absolutePath, type, oldValue }) => {
							if (type !== 'replace') return acc;
							return addInterfaceProp(acc, absolutePath, oldValue);
						}, [] as Interface[])

						returnData.push({ json: { interfaces } });

						break;
					}
					case 'generateJinja2': {
						const ast = this.getNodeParameter('ast', i) as JuniperNode;
						const diff = this.getNodeParameter('diff', i) as JuniperDiff[];
						const interfacex = this.getNodeParameter('interface', i) as Interface;
						const jinja2Ast = convertToJinja2Ast(ast, diff, { interface: interfacex });
						const jinja2String = astToConfig(jinja2Ast).replace(/%};/g, '%}');

						returnData.push({ json: { jinja2: jinja2String } });

						break;
					}
				}
      } catch (error) {
        if (this.continueOnFail()) {
          returnData.push({
            json: {
              error: error.message,
            },
          });
          continue;
        }
        throw error;
      }
    }

    return [returnData];
  }
}

