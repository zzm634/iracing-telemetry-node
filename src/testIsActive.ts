import { Observable, connect, merge } from "rxjs";
import { isActive, sleep } from "./async";

async function randomEmissions(emit: () => void) {
  console.log("started");

  await sleep(5000).value;

  while (true) {
    emit();
    const sleepFor = 1000 + Math.random() * 2000;
    console.log({ sleepFor });
    await sleep(sleepFor).value;
  }
}

const randomEmit: Observable<void> = new Observable((subscriber) => {
  randomEmissions(() => subscriber.next());
});

const active = isActive(randomEmit, 2500);

active.subscribe((a) => console.log(a));
