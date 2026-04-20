import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  report: null,
  loading: false,
  error: null,
};

const monthlyReportSlice = createSlice({
  name: 'monthlyReport',
  initialState,
  reducers: {
    setReport(state, action) {
      state.report = action.payload;
    },
    setLoading(state, action) {
      state.loading = action.payload;
    },
    setError(state, action) {
      state.error = action.payload;
    },
  },
});

export const { setReport, setLoading, setError } = monthlyReportSlice.actions;
export default monthlyReportSlice.reducer;
