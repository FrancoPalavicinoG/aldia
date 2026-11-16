export interface Found {
  path?: string;
  problem?: string;
}

// Not written yet: the tests that use it show what a program found by name can run.
export function findProgram(_name: string, _env: NodeJS.ProcessEnv, _avoid: string[] = []): Found {
  return {};
}
