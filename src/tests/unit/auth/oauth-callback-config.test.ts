import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getOAuthCallbackHost,
  getOAuthCallbackPort,
  validateOAuthCallbackConfig,
  detectConfigTypos
} from '../../../auth/utils.js';

describe('OAuth Callback Configuration', () => {
  // Store original environment
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clean environment before each test
    delete process.env.OAUTH_CALLBACK_HOST;
    delete process.env.OAUTH_CALLBACK_PORT;
    delete process.env.OAUTH_CALLBAK_HOST; // Typo variants
    delete process.env.OAUTH_CALLBACK_HST;
    delete process.env.OAUTH_CALLBAK_PORT;
    delete process.env.OAUTH_CALLBACK_PRT;
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
  });

  describe('getOAuthCallbackHost', () => {
    it('should default to localhost', () => {
      expect(getOAuthCallbackHost()).toBe('localhost');
    });

    it('should use environment variable when set', () => {
      process.env.OAUTH_CALLBACK_HOST = '192.168.1.100';
      expect(getOAuthCallbackHost()).toBe('192.168.1.100');
    });

    it('should handle 127.0.0.1', () => {
      process.env.OAUTH_CALLBACK_HOST = '127.0.0.1';
      expect(getOAuthCallbackHost()).toBe('127.0.0.1');
    });

    it('should handle domain names', () => {
      process.env.OAUTH_CALLBACK_HOST = 'example.com';
      expect(getOAuthCallbackHost()).toBe('example.com');
    });

    it('should handle IPv6 addresses', () => {
      process.env.OAUTH_CALLBACK_HOST = '::1';
      expect(getOAuthCallbackHost()).toBe('::1');
    });
  });

  describe('getOAuthCallbackPort', () => {
    it('should return undefined by default', () => {
      expect(getOAuthCallbackPort()).toBeUndefined();
    });

    it('should parse valid port from environment', () => {
      process.env.OAUTH_CALLBACK_PORT = '3500';
      expect(getOAuthCallbackPort()).toBe(3500);
    });

    it('should handle different valid ports', () => {
      process.env.OAUTH_CALLBACK_PORT = '8080';
      expect(getOAuthCallbackPort()).toBe(8080);

      process.env.OAUTH_CALLBACK_PORT = '443';
      expect(getOAuthCallbackPort()).toBe(443);

      process.env.OAUTH_CALLBACK_PORT = '65535';
      expect(getOAuthCallbackPort()).toBe(65535);
    });

    it('should throw error for invalid port string', () => {
      process.env.OAUTH_CALLBACK_PORT = 'invalid';
      expect(() => getOAuthCallbackPort()).toThrow('Invalid OAUTH_CALLBACK_PORT: invalid. Must be between 1 and 65535.');
    });

    it('should throw error for port zero', () => {
      process.env.OAUTH_CALLBACK_PORT = '0';
      expect(() => getOAuthCallbackPort()).toThrow('Invalid OAUTH_CALLBACK_PORT: 0. Must be between 1 and 65535.');
    });

    it('should throw error for negative port', () => {
      process.env.OAUTH_CALLBACK_PORT = '-1';
      expect(() => getOAuthCallbackPort()).toThrow('Invalid OAUTH_CALLBACK_PORT: -1. Must be between 1 and 65535.');
    });

    it('should throw error for port above 65535', () => {
      process.env.OAUTH_CALLBACK_PORT = '99999';
      expect(() => getOAuthCallbackPort()).toThrow('Invalid OAUTH_CALLBACK_PORT: 99999. Must be between 1 and 65535.');
    });

    it('should return undefined for empty string', () => {
      process.env.OAUTH_CALLBACK_PORT = '';
      expect(getOAuthCallbackPort()).toBeUndefined();
    });

    it('should throw error for non-numeric strings', () => {
      process.env.OAUTH_CALLBACK_PORT = '3500abc';
      expect(() => getOAuthCallbackPort()).toThrow('Invalid OAUTH_CALLBACK_PORT: 3500abc. Must be between 1 and 65535.');
    });
  });

  describe('detectConfigTypos', () => {
    it('should not output anything when no typos present', () => {
      const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      detectConfigTypos();

      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('should warn about OAUTH_CALLBAK_HOST typo', () => {
      const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      process.env.OAUTH_CALLBAK_HOST = '192.168.1.100'; // Missing 'C'

      detectConfigTypos();

      expect(spy).toHaveBeenCalledWith(expect.stringContaining('OAUTH_CALLBAK_HOST'));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('OAUTH_CALLBACK_HOST'));
      spy.mockRestore();
    });

    it('should warn about OAUTH_CALLBACK_HST typo', () => {
      const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      process.env.OAUTH_CALLBACK_HST = '192.168.1.100'; // Missing 'O'

      detectConfigTypos();

      expect(spy).toHaveBeenCalledWith(expect.stringContaining('OAUTH_CALLBACK_HST'));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('OAUTH_CALLBACK_HOST'));
      spy.mockRestore();
    });

    it('should warn about OAUTH_CALLBAK_PORT typo', () => {
      const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      process.env.OAUTH_CALLBAK_PORT = '3500'; // Missing 'C'

      detectConfigTypos();

      expect(spy).toHaveBeenCalledWith(expect.stringContaining('OAUTH_CALLBAK_PORT'));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('OAUTH_CALLBACK_PORT'));
      spy.mockRestore();
    });

    it('should warn about OAUTH_CALLBACK_PRT typo', () => {
      const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      process.env.OAUTH_CALLBACK_PRT = '3500'; // Missing 'O'

      detectConfigTypos();

      expect(spy).toHaveBeenCalledWith(expect.stringContaining('OAUTH_CALLBACK_PRT'));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('OAUTH_CALLBACK_PORT'));
      spy.mockRestore();
    });

    it('should detect multiple typos', () => {
      const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      process.env.OAUTH_CALLBAK_HOST = '192.168.1.100';
      process.env.OAUTH_CALLBAK_PORT = '3500';

      detectConfigTypos();

      expect(spy).toHaveBeenCalledTimes(2);
      spy.mockRestore();
    });
  });

  describe('validateOAuthCallbackConfig', () => {
    it('should show configuration for localhost (default)', () => {
      const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      validateOAuthCallbackConfig(3500);

      expect(spy).toHaveBeenCalledWith(expect.stringContaining('OAuth Configuration:'));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Host: localhost (default)'));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Port: 3500 (auto-detected)'));
      expect(spy).not.toHaveBeenCalledWith(expect.stringContaining('REMOTE HOST DETECTED'));
      spy.mockRestore();
    });

    it('should show configuration for localhost with explicit env var', () => {
      const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      process.env.OAUTH_CALLBACK_HOST = 'localhost';
      process.env.OAUTH_CALLBACK_PORT = '3500';

      validateOAuthCallbackConfig(3500);

      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Port: 3500 (OAUTH_CALLBACK_PORT env var)'));
      expect(spy).not.toHaveBeenCalledWith(expect.stringContaining('REMOTE HOST DETECTED'));
      spy.mockRestore();
    });

    it('should show remote host setup instructions for IP address', () => {
      const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      process.env.OAUTH_CALLBACK_HOST = '192.168.1.100';

      validateOAuthCallbackConfig(3500);

      expect(spy).toHaveBeenCalledWith(expect.stringContaining('REMOTE HOST DETECTED - SETUP REQUIRED'));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('http://192.168.1.100:3500/oauth2callback'));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('https://console.cloud.google.com/apis/credentials'));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Authorized redirect URIs'));
      spy.mockRestore();
    });

    it('should show SSH tunneling suggestion for remote hosts', () => {
      const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      process.env.OAUTH_CALLBACK_HOST = '192.168.1.100';

      validateOAuthCallbackConfig(3500);

      expect(spy).toHaveBeenCalledWith(expect.stringContaining('SSH tunneling'));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('ssh -L 3500:localhost:3500'));
      spy.mockRestore();
    });

    it('should show firewall instructions for remote hosts', () => {
      const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      process.env.OAUTH_CALLBACK_HOST = '192.168.1.100';

      validateOAuthCallbackConfig(3500);

      expect(spy).toHaveBeenCalledWith(expect.stringContaining('firewall'));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('curl http://192.168.1.100:3500'));
      spy.mockRestore();
    });

    it('should not show remote warnings for 127.0.0.1', () => {
      const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      process.env.OAUTH_CALLBACK_HOST = '127.0.0.1';

      validateOAuthCallbackConfig(3500);

      expect(spy).not.toHaveBeenCalledWith(expect.stringContaining('REMOTE HOST DETECTED'));
      spy.mockRestore();
    });

    it('should show correct port in callback URL', () => {
      const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      process.env.OAUTH_CALLBACK_HOST = '192.168.1.100';

      validateOAuthCallbackConfig(8080);

      expect(spy).toHaveBeenCalledWith(expect.stringContaining('http://192.168.1.100:8080/oauth2callback'));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('curl http://192.168.1.100:8080'));
      spy.mockRestore();
    });

    it('should indicate env var source when port is configured', () => {
      const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      process.env.OAUTH_CALLBACK_PORT = '3500';

      validateOAuthCallbackConfig(3500);

      expect(spy).toHaveBeenCalledWith(expect.stringContaining('OAUTH_CALLBACK_PORT env var'));
      spy.mockRestore();
    });

    it('should indicate auto-detection when port is not configured', () => {
      const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      validateOAuthCallbackConfig(3501);

      expect(spy).toHaveBeenCalledWith(expect.stringContaining('3501 (auto-detected)'));
      spy.mockRestore();
    });

    it('should handle domain names as remote hosts', () => {
      const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      process.env.OAUTH_CALLBACK_HOST = 'example.com';

      validateOAuthCallbackConfig(3500);

      expect(spy).toHaveBeenCalledWith(expect.stringContaining('REMOTE HOST DETECTED'));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('http://example.com:3500/oauth2callback'));
      spy.mockRestore();
    });
  });
});
