import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  loans: [],
  currentLoan: null,
  loading: false,
  error: null,
};

const loanSlice = createSlice({
  name: 'loans',
  initialState,
  reducers: {
    setLoans(state, action) {
      state.loans = action.payload;
    },
    setCurrentLoan(state, action) {
      state.currentLoan = action.payload;
    },
    setLoading(state, action) {
      state.loading = action.payload;
    },
    setError(state, action) {
      state.error = action.payload;
    },
  },
});

export const { setLoans, setCurrentLoan, setLoading, setError } = loanSlice.actions;
export default loanSlice.reducer;
