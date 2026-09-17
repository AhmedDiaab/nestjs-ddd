import {
    parseOracleUrl,
    toExecuteDefaults,
    toPoolAttributes,
} from '@infrastructure/database/clients';
import oracledb from 'oracledb';
import { oracleSource } from '../../../../fixtures/database/oracle-source';

describe('oracle pool options', () => {
    it('maps source config to PoolAttributes with the right units', () => {
        const attrs = toPoolAttributes(
            oracleSource({
                poolTimeoutSec: 30,
                poolPingTimeoutMs: 2000,
                queueTimeoutMs: 15000,
                connectTimeoutSec: 5,
                expireTimeMin: 2,
            }),
        );

        expect(attrs).toMatchObject({
            poolAlias: 'main',
            user: 'app',
            password: 'secret',
            connectString: 'localhost:1521/FREEPDB1',
            poolMin: 2,
            poolMax: 10,
            poolTimeout: 30,
            poolPingTimeout: 2000,
            queueTimeout: 15000,
            connectTimeout: 5,
            transportConnectTimeout: 5,
            expireTime: 2,
        });
    });

    it('derives credentials from connectionUrl', () => {
        const attrs = toPoolAttributes(
            oracleSource({
                connectString: undefined,
                user: undefined,
                password: undefined,
                connectionUrl: 'oracle://scott:p%40ss@db.local:1522/ORCLPDB1',
            }),
        );

        expect(attrs).toMatchObject({
            user: 'scott',
            password: 'p@ss',
            connectString: 'db.local:1522/ORCLPDB1',
        });
    });

    it('defaults the port to 1521', () => {
        expect(parseOracleUrl('oracle://u:p@host/SVC').connectString).toBe('host:1521/SVC');
    });

    it('omits user/password for external auth', () => {
        const attrs = toPoolAttributes(oracleSource({ externalAuth: true }));
        expect(attrs.user).toBeUndefined();
        expect(attrs.password).toBeUndefined();
        expect(attrs.externalAuth).toBe(true);
    });

    it('maps outFormat', () => {
        expect(toExecuteDefaults(oracleSource({ outFormat: 'object' })).outFormat).toBe(
            oracledb.OUT_FORMAT_OBJECT,
        );
        expect(toExecuteDefaults(oracleSource()).outFormat).toBe(oracledb.OUT_FORMAT_ARRAY);
    });
});
