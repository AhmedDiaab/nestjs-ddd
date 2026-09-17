import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_NAME } from '@shared';
import { renameContent, toProjectNames } from '../../../scripts/rename-project.lib';

const root = join(__dirname, '../../..');

describe('rename-project', () => {
    it('derives Pascal and title case names from a kebab name', () => {
        // Arrange
        const kebab = 'orders-api';

        // Act
        const names = toProjectNames(kebab);

        // Assert
        expect(names).toEqual({ kebab: 'orders-api', pascal: 'OrdersApi', title: 'Orders Api' });
    });

    it('uses an explicit display title when given', () => {
        // Arrange
        const title = 'Order Desk';

        // Act
        const names = toProjectNames('orders', title);

        // Assert
        expect(names.title).toBe('Order Desk');
    });

    it.each(['Orders', 'orders_api', '-orders', 'orders--api', ''])('rejects %j', (kebab) => {
        // Arrange: name from table

        // Act
        const derive = () => toProjectNames(kebab);

        // Assert
        expect(derive).toThrow('kebab-case');
    });

    it('replaces every template identifier form', () => {
        // Arrange
        const content = [
            "export const APP_NAME = 'nestjs-ddd';",
            '[string]$ServiceName = "NestjsDddApiService",',
            "export const SWAGGER_API_TITLE = 'NestJS DDD API';",
        ].join('\n');

        // Act
        const renamed = renameContent(content, toProjectNames('orders'));

        // Assert
        expect(renamed).toBe(
            [
                "export const APP_NAME = 'orders';",
                '[string]$ServiceName = "OrdersApiService",',
                "export const SWAGGER_API_TITLE = 'Orders API';",
            ].join('\n'),
        );
    });

    it('keeps APP_NAME in sync with package.json name', () => {
        // Arrange
        const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
            name: string;
        };

        // Act
        const sameName = APP_NAME === pkg.name;

        // Assert
        expect(sameName).toBe(true);
    });
});
