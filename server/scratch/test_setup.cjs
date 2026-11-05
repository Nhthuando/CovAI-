try {
  if (typeof jest !== 'undefined') {
    jest.mock('mathjs', () => ({
      create: () => ({ evaluate: jest.fn(() => 2) }),
      all: {}
    }), { virtual: true });
  }
} catch (_) {}
