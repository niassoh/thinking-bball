<VictoryPie
  padAngle={({ datum }) => datum.y}
  innerRadius={100}
  colorScale={[
    'rgb(52, 123, 189, .8)',
    '#7b9dbd',
    'rgb(217, 72, 15, .3)',
    'rgb(217, 72, 15, .9)',
    'rgb(52, 123, 189, .4)',
  ]}
  data={sampleData}
  data={[
    { x: 'PnR', y: 7 },
    { x: 'Iso', y: 3 },
    { x: 'Off Screen', y: 3 },
    { x: 'Cut', y: 2 },

    { x: 'Spot', y: 3 },
  ]}
/>;
