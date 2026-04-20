import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  cycles: [],
  currentCycle: null,
  loading: false,
  error: null,
};

const cycleSlice = createSlice({
  name: 'cycles',
  initialState,
  reducers: {
    setCycles(state, action) {
      state.cycles = action.payload;
    },
    setCurrentCycle(state, action) {
      state.currentCycle = action.payload;
    },
    setLoading(state, action) {
      state.loading = action.payload;
    },
    setError(state, action) {
      state.error = action.payload;
    },
  },
});

export const { setCycles, setCurrentCycle, setLoading, setError } = cycleSlice.actions;
export default cycleSlice.reducer;
