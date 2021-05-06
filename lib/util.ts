import { wait } from 'f-promise-async';

export async function nextTick() {
    await wait(cb => process.nextTick(cb));
}
