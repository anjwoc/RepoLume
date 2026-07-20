import { create } from 'zustand';

interface JobStore {
  jobs: Record<string, string>;
  setJob: (pageId: string, jobId: string) => void;
  removeJob: (pageId: string) => void;
}

export const useJobStore = create<JobStore>((set) => ({
  jobs: {},
  setJob: (pageId, jobId) =>
    set((state) => ({ jobs: { ...state.jobs, [pageId]: jobId } })),
  removeJob: (pageId) =>
    set((state) => {
      const { [pageId]: _, ...rest } = state.jobs;
      return { jobs: rest };
    }),
}));
