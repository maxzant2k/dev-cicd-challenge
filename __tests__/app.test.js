const request = require('supertest');
const app = require('../src/app');

describe('GET /', () => {
  it('should return a challenge completed page', async () => {
    const response = await request(app).get('/');

    expect(response.statusCode).toBe(200);
    expect(response.text).toContain('Challenge finalizado');
  });
});

describe('GET /health', () => {
  beforeAll(() => {
    process.env.APP_ENV = 'test';
  });

  it('should return 200 and status ok when APP_ENV is set', async () => {
    const response = await request(app).get('/health');

    expect(response.statusCode).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it('should return 500 when APP_ENV is not set', async () => {
    const originalEnv = process.env.APP_ENV;
    delete process.env.APP_ENV;

    const response = await request(app).get('/health');

    expect(response.statusCode).toBe(500);
    expect(response.body.status).toBe('degraded');

    process.env.APP_ENV = originalEnv;
  });
});
