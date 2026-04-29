import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  savings: [],
  loading: false,
  error: null,
};

const savingsSlice = createSlice({
  name: 'savings',
  initialState,
  reducers: {
    setSavings(state, action) {
      state.savings = action.payload;
    },
    setLoading(state, action) {
      state.loading = action.payload;
    },
    setError(state, action) {
      state.error = action.payload;
    },
  },
});

export const { setSavings, setLoading, setError } = savingsSlice.actions;
export default savingsSlice.reducer;
