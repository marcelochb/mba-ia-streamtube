import { Body, Controller, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import { IsString } from 'class-validator';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/bootstrap/configure-app';
import type { ErrorResponseBody } from './../src/common/filters/all-exceptions.filter';

class SampleDto {
  @IsString()
  name: string;
}

/** supertest types `response.body` as `any`; narrow it once, here. */
const errorBody = (response: { body: unknown }): ErrorResponseBody =>
  response.body as ErrorResponseBody;

/** Exists only to give the ValidationPipe a DTO to reject against. */
@Controller('bootstrap-probe')
class ProbeController {
  @Post()
  create(@Body() dto: SampleDto): SampleDto {
    return dto;
  }
}

describe('Bootstrap defenses (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();

    // The very same function main.ts calls — asserting against a hand-copied
    // setup would let this suite pass while the real bootstrap was broken.
    configureApp(app);

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('security headers', () => {
    it('sets the helmet headers on responses', async () => {
      const response = await request(app.getHttpServer()).get('/').expect(200);

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers).toHaveProperty('x-frame-options');
    });

    it('does not advertise the framework via X-Powered-By', async () => {
      const response = await request(app.getHttpServer()).get('/');

      expect(response.headers).not.toHaveProperty('x-powered-by');
    });
  });

  describe('CORS', () => {
    it('echoes the allowed origin, never a wildcard', async () => {
      const response = await request(app.getHttpServer())
        .get('/')
        .set('Origin', 'http://localhost:3001');

      expect(response.headers['access-control-allow-origin']).toBe(
        'http://localhost:3001',
      );
    });

    it('does not grant a permissive origin to an unauthorized site', async () => {
      const response = await request(app.getHttpServer())
        .get('/')
        .set('Origin', 'http://evil.example.com');

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(response.headers['access-control-allow-origin']).not.toBe('*');
    });
  });

  describe('validation', () => {
    it('rejects a body carrying an undeclared property with 400', async () => {
      const response = await request(app.getHttpServer())
        .post('/bootstrap-probe')
        .send({ name: 'ok', isAdmin: true })
        .expect(400);

      const body = errorBody(response);
      expect(body).toMatchObject({
        statusCode: 400,
        error: expect.any(String),
      });
      expect(JSON.stringify(body.message)).toContain('isAdmin');
    });

    it('rejects a body with a wrong field type with 400', async () => {
      const response = await request(app.getHttpServer())
        .post('/bootstrap-probe')
        .send({ name: 42 })
        .expect(400);

      const body = errorBody(response);
      expect(Array.isArray(body.message)).toBe(true);
    });
  });

  describe('error catalog format', () => {
    it('returns 404 in { statusCode, error, message } for an unmapped route', async () => {
      const response = await request(app.getHttpServer())
        .get('/definitely-not-a-route')
        .expect(404);

      expect(errorBody(response)).toEqual({
        statusCode: 404,
        error: expect.any(String),
        message: expect.any(String),
      });
    });

    it('never includes a stack trace in an error body', async () => {
      const response = await request(app.getHttpServer())
        .get('/definitely-not-a-route')
        .expect(404);

      expect(errorBody(response)).not.toHaveProperty('stack');
      expect(JSON.stringify(errorBody(response))).not.toContain('at ');
    });
  });
});
