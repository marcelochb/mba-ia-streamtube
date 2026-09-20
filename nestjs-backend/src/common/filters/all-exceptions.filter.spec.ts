import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import {
  AllExceptionsFilter,
  type ErrorResponseBody,
} from './all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let json: jest.Mock<void, [ErrorResponseBody]>;
  let status: jest.Mock;
  let host: ArgumentsHost;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    // Silence the filter's own logging so failing-path tests stay readable.
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
    jest.spyOn(filter['logger'], 'warn').mockImplementation(() => undefined);

    json = jest.fn<void, [ErrorResponseBody]>();
    status = jest.fn().mockReturnValue({ json });

    host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ method: 'GET', url: '/videos' }),
      }),
    } as unknown as ArgumentsHost;
  });

  const captureBody = (): ErrorResponseBody => json.mock.calls[0][0];

  it('normalizes an HttpException to { statusCode, error, message }', () => {
    filter.catch(new NotFoundException('Cannot GET /videos'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(captureBody()).toEqual({
      statusCode: 404,
      error: 'NOT_FOUND',
      message: 'Cannot GET /videos',
    });
  });

  it('preserves the validation message list of a 400', () => {
    const messages = ['email must be an email', 'password is too short'];

    filter.catch(new BadRequestException({ message: messages }), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(captureBody().message).toEqual(messages);
  });

  it('collapses an unknown exception to a generic 500', () => {
    filter.catch(new Error('connect ECONNREFUSED 10.0.0.5:5432'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(captureBody()).toEqual({
      statusCode: 500,
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
    });
  });

  it('never leaks a stack trace or internal detail in the response body', () => {
    const exception = new Error('password=hunter2 at /srv/app/src/db.ts:42');

    filter.catch(exception, host);

    const serialized = JSON.stringify(captureBody());
    expect(serialized).not.toContain('stack');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('/srv/app');
    expect(captureBody()).not.toHaveProperty('stack');
  });

  it('keeps a domain error code supplied by the thrower', () => {
    filter.catch(
      new HttpException(
        { error: 'VIDEO_NOT_PUBLISHED', message: 'Video is not published' },
        HttpStatus.CONFLICT,
      ),
      host,
    );

    expect(captureBody()).toEqual({
      statusCode: 409,
      error: 'VIDEO_NOT_PUBLISHED',
      message: 'Video is not published',
    });
  });

  it('logs the cause of a 500 server-side instead of returning it', () => {
    const logSpy = jest
      .spyOn(filter['logger'], 'error')
      .mockImplementation(() => undefined);

    filter.catch(new Error('boom'), host);

    expect(logSpy).toHaveBeenCalled();
    expect(JSON.stringify(captureBody())).not.toContain('boom');
  });
});
