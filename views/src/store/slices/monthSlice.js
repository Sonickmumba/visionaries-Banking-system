// Month slice — tracks current month in the savings cycle
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  currentMonth: 1,
};

const monthSlice = createSlice({
  name: 'month',
  initialState,
  reducers: {
    advanceToNextMonth(state) {
      state.currentMonth += 1;
    },
    setMonth(state, action) {
      state.currentMonth = action.payload;
    },
    resetMonth(state) {
      state.currentMonth = 1;
    },
  },
});

export const { advanceToNextMonth, setMonth, resetMonth } = monthSlice.actions;
export default monthSlice.reducer;
