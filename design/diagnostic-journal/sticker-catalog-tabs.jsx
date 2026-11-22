import React from 'react';
import {createRoot} from 'react-dom/client';
import {Tabs as Primitive} from 'radix-ui';

// shadcn Tabs composition, with the Mira line variant mapped to preview tokens.
const Tabs = props => <Primitive.Root data-slot="tabs" {...props}/>;
const TabsList = props => <Primitive.List data-slot="tabs-list" data-variant="line" {...props}/>;
const TabsTrigger = props => <Primitive.Trigger data-slot="tabs-trigger" {...props}/>;
const TabsContent = props => <Primitive.Content data-slot="tabs-content" {...props}/>;

const host = document.querySelector('#sticker-catalog-tabs');
if (host) createRoot(host).render(
  <Tabs defaultValue="personal">
    <TabsList aria-label="Коллекция стикеров">
      <TabsTrigger value="personal">Личное</TabsTrigger>
      <TabsTrigger value="public">Общее</TabsTrigger>
    </TabsList>
    {[['personal','Пока нет личных наборов. Импортируйте свой набор или найдите его в общем каталоге.'],['public','Пока нет опубликованных наборов.']].map(([value,text]) => (
      <TabsContent key={value} value={value} data-sticker-panel={value} className="panel preview-empty"><p className="muted">{text}</p></TabsContent>
    ))}
  </Tabs>
);
