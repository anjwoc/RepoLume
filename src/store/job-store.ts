import { create } from 'zustand';

type JobId = string;
type PageId = string;

interface JobState {
  activeJobs: Record<PageId, JobId>;
  setJob: (pageId: string, jobId: string) => void;
  removeJob: (pageId: string) => void;
  getJob: (pageId: string) => string | undefined;
}

export const useJobStore = create<JobState>((set, get) => ({
  activeJobs: {},
  setJob: (pageId, jobId) =>
    set((state) => ({
      activeJobs: { ...state.activeJobs, [pageId]: jobId },
    })),
  removeJob: (pageId) =>
    set((state) => {
      const { [pageId]: _, ...rest } = state.activeJobs;
      return { activeJobs: rest };
    }),
  getJob: (pageId) => get().activeJobs[pageId],
}));
