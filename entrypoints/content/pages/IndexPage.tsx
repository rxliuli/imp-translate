import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { XIcon } from 'lucide-react'
import { useState } from 'react'

export function IndexPage() {
  const [isOpen, setIsOpen] = useState(true)
  return (
    <div
      className={cn(
        'fixed w-full top-0 left-0 h-screen flex flex-col',
        isOpen ? 'flex' : 'hidden',
      )}
    >
      <Card>
        <CardHeader>
          <CardTitle>Hello World!</CardTitle>
          <CardDescription>This is a description</CardDescription>
          <CardAction>
            <Button
              variant={'secondary'}
              size={'icon'}
              onClick={() => setIsOpen(false)}
            >
              <XIcon className={'w-4 h-4'} />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <p>Hello World!</p>
        </CardContent>
        <CardFooter className={'space-x-2'}>
          <Button>Click me</Button>
          <Button variant={'secondary'} onClick={() => setIsOpen(false)}>
            Close
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
